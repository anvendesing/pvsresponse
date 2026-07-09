// Imports the real product catalog from the user's two Excel price lists
// (MRP + Dealer) and rebuilds Product/Variant/PriceListItem rows.
//
// Strategy:
//   1. Parse both spreadsheets into row objects, joining MRP <-> Dealer by
//      the "OS/RC/CH/..." product code (the secondary code column).
//   2. Detect section headers (Edible Oils, Rice/Pulses, Spices, ...) and
//      tag each row with its category.
//   3. Extract a canonical "base name" by stripping parenthetical hints
//      (e.g. "(Plastic Bottle)") and trailing junk. This becomes the
//      Product. Each row in the family becomes a Variant identified by
//      (size, container).
//   4. Generate a short family SKU code using a curated map for the most
//      common products + an auto-generator for the rest. e.g. Coconut
//      Oil -> "COIL", Groundnut Oil -> "GNOL".
//   5. Wipe existing products/variants/price-list-items and rewrite them.
//   6. Seed the existing RETAIL price list with MRP prices and DEALER
//      with dealer prices. (Existing pricing seed rules in seed.ts are
//      replaced entirely.)
//
// This is meant to be run ONCE per refresh of the user's price lists.

import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const MRP_FILE =
  "C:/Users/Sharath/Downloads/New261124/test140525/MRP PRICE LIST MARCH 2026.xlsx";
const DEALER_FILE =
  "C:/Users/Sharath/Downloads/New261124/test140525/DEALERS PRICE LIST MARCH 2026..xlsx";

// ============================================================ data types ===

type Category =
  | "Edible Oils"
  | "Rice Cereals & Pulses"
  | "Cosmetics & Herbal"
  | "Dry Fruits & Health"
  | "Millets"
  | "Spices & Pickles"
  | "Sweets & Savories"
  | "Books"
  | "Water Filter"
  | "Miscellaneous";

interface Row {
  category: Category;
  productCode: string; // OS001, RC101, ...
  name: string; // raw name
  hsn: string;
  size: string; // raw, e.g. "5 Ltr" / "500 gms"
  mrp: number;
  dealerPrice: number;
  expiry: string;
  gst: number;
  inStock: boolean;
}

// =========================================================== normalizers ===

// Trim, collapse spaces.
const norm = (s: unknown): string => String(s ?? "").trim().replace(/\s+/g, " ");

// Number-coerce, returns NaN if not a number.
const numF = (s: unknown): number => {
  if (typeof s === "number") return s;
  const n = parseFloat(String(s ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

// Map of misspellings -> correct spelling. Applied to product NAMES.
const SPELL_FIXES: [RegExp, string][] = [
  [/\bCardmom\b/gi, "Cardamom"],
  [/\bChilly\b/gi, "Chilli"],
  [/\bGoundnut\b/gi, "Groundnut"],
  [/\bWallnuts?\b/gi, "Walnuts"],
  [/\bHght\b/gi, "High"],
  [/\bAlovera\b/gi, "Aloe Vera"],
  [/\bMulthani Matti\b/gi, "Multani Mitti"],
  [/\bMulthani\b/gi, "Multani"],
  [/\bMosquito Repellent Oil \(Citronella Oil\)/gi, "Mosquito Repellent Oil (Citronella)"],
  // Squash the multi-name aliases that appear in oils/seeds. We keep the
  // first canonical name and drop the slashed aliases for clarity.
  [/Gingely\s*\/\s*Sesame\s*\/\s*Til\s*\/\s*Nuvvulu/gi, "Sesame"],
  [/Sesame\s*\/\s*Gingely\s*\/\s*Til\s*\/\s*Nuvvulu/gi, "Sesame"],
  [/Verri Nuvvulu \/ Niger/gi, "Niger"],
  [/Niger\s*\/\s*Verri Nuvvulu/gi, "Niger"],
  // Keep Jonnalu (white)/ Jowar as the canonical white-jowar family name.
  [/^Jowar \(White\) Flour$/gi, "Jonnalu (white)/ Jowar Flour"],
  [/^Jowar \(White\) Ravva$/gi, "Jonnalu (white)/ Jowar Ravva"],
  [/^Jowar \(White\)$/gi, "Jonnalu (white)/ Jowar"],
  [/Jonna Atukulu \/ Jowar Poha/gi, "Jowar Poha"],
  [/Pacha Jonnalu \/ Jowar \(Yellow\)/gi, "Jowar (Yellow)"],
  [/Korralu \/ Foxtail Millet/gi, "Foxtail Millet"],
  [/Korra Atukulu \/ Foxtail Millet Poha/gi, "Foxtail Millet Poha"],
  [/Samalu \/ Little Millet/gi, "Little Millet"],
  [/Sama Atukulu \/ Little Millet Poha/gi, "Little Millet Poha"],
  [/Varigalu \/ Proso Millet/gi, "Proso Millet"],
  [/Sajjalu \/ Bajra/gi, "Bajra"],
  [/Sajja Atukulu \/ Bajra Poha/gi, "Bajra Poha"],
  [/Ragulu \/ Finger Millet/gi, "Finger Millet"],
  [/Ragi Atukulu \/ Finger Millet Poha/gi, "Finger Millet Poha"],
  [/Andu Korralu \/ Brown Top Millet/gi, "Brown Top Millet"],
  [/Arikalu \/ Kodo Millet/gi, "Kodo Millet"],
  [/Arika Atukulu \/ Kodo Millet Poha/gi, "Kodo Millet Poha"],
  [/Udarlu \/ Barnyard Millet/gi, "Barnyard Millet"],
  [/Udarlu Atukulu \/ Barnyard Millet Poha/gi, "Barnyard Millet Poha"],
];

const cleanName = (s: string): string => {
  let out = norm(s);
  for (const [re, sub] of SPELL_FIXES) out = out.replace(re, sub);
  return out.replace(/\s+/g, " ").trim();
};

// Strip parenthetical container hints from name AND return them. Used to
// split "Coconut Oil (Plastic Bottle Only)" into ("Coconut Oil", "Plastic Bottle Only").
const splitContainer = (name: string): { base: string; container: string | null } => {
  // Find the last parenthetical group. We use last so "Bath Soap (Cow Milk
  // & Sandal Wood)" treats the parenthetical as the VARIANT spec.
  const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!m) return { base: name.trim(), container: null };
  return { base: m[1].trim(), container: m[2].trim() };
};

// Parse a size string into normalized form and machine-friendly bits.
const parseSize = (raw: string): { label: string; unit: string; magnitude: number } => {
  const t = norm(raw);
  const m = t.match(/([\d.]+)\s*(ltr|lit|l|ml|kg|kgs|gms?|g|inch|sq\s*mt|pcs?|no|sticks?|cm\*[\d.]+cm)/i);
  if (!m) return { label: t || "—", unit: "", magnitude: 0 };
  let mag = parseFloat(m[1]);
  let unit = m[2].toLowerCase().replace(/\s+/g, "");
  if (unit === "ltr" || unit === "lit" || unit === "l") unit = "l";
  else if (unit === "kgs") unit = "kg";
  else if (unit === "gms" || unit === "g") unit = "g";
  else if (unit === "pcs") unit = "pc";
  else if (unit === "sticks") unit = "sticks";
  // Express label in original (cleaned)
  const label =
    unit === "l"
      ? `${mag} L`
      : unit === "ml"
        ? `${mag} ml`
        : unit === "kg"
          ? `${mag} kg`
          : unit === "g"
            ? `${mag} g`
            : t;
  return { label, unit, magnitude: mag };
};

// =========================================================== code maker ===
// Curated family-code map (3-4 letters, uppercase). For anything not
// listed we fall back to an auto-generator (first letters of significant
// words, capped at 4).

const FAMILY_CODE_MAP: Record<string, string> = {
  // Edible oils
  "Coconut Oil": "COIL",
  "Coconut Cake": "CCAK",
  "Sesame Seeds": "SSED",
  "White Sesame Seeds": "WSSD",
  "Sesame Oil": "SOIL",
  "White Sesame Oil": "WSOL",
  "Sesame Cake": "SCAK",
  "White Sesame Cake": "WSCK",
  "Groundnut Seed": "GNSD",
  "Groundnut Oil": "GOIL",
  "Groundnut Cake": "GCAK",
  "Safflower Seeds": "SFSD",
  "Safflower Oil": "SFOL",
  "Safflower Cake": "SFCK",
  "Kusuma Oil": "SFOL",
  "Safflower / Kusuma Oil": "SFOL",
  "Safflower / Kusuma - Cake": "SFCK",
  "Niger Seed": "NGSD",
  "Niger Seed Oil": "NGOL",
  "Mustard Oil": "MUOL",
  "Fried Groundnuts": "FGRN",
  // Rice & Pulses
  "Blackgram whole": "BGRM",
  "Blackgram without Husk": "BGHK",
  "Blackgram stone crushed": "BGSC",
  "Black Pesalu": "BPSL",
  "Black Pesalu Stone Crushed": "BPSC",
  "Channa (white)": "CHWH",
  "Channa (black)": "CHBK",
  "Channa Dal": "CHDL",
  "Channa Flour": "CHFL",
  "CowPea": "CWPA",
  "Cowpea Dal": "CWPD",
  "Red CowPea": "RCWP",
  "Fried Channa dal": "FCDL",
  "Greengram Whole / Pesalu": "GGWH",
  "Greengram Dal / stone crushed": "GGDL",
  "Horsegram whole": "HGWH",
  "Horsegram dal": "HGDL",
  "Rajma beans": "RJMA",
  "Redgram stone crushed": "RGDL",
  "Soya beans": "SOYA",
  "Anapa pappu": "ANPA",
  "Fine Rice (Single Polish)": "FRPL",
  "Fine Rice (Unpolished)": "FRUP",
  "Red Rice (Unpolished)": "RRUP",
  "Navara Rice": "NVRC",
  "Rajamudi Rice": "RJRC",
  "Sidda Sana Rice": "SSRC",
  "Black Rice": "BKRC",
  "Desi Basmati Rice": "DBRC",
  "Boiled Rice": "BLRC",
  "Chitti Muthyalu rice": "CMRC",
  "DIABETIC RICE": "DBRC",
  "Red Rice Ravva": "RRRV",
  "Red Rice Flour": "RRFL",
  "Rice Ravva": "RRVW",
  "Rice Flour": "RFLW",
  "Red Rice Poha": "RRPH",
  "Rice Poha": "WRPH",
  "Wheat": "WHET",
  "Wheat Flour": "WHFL",
  "Wheat Ravva": "WHRV",
  "Multi grain Atta": "MGAT",
  "Sambhava wheat": "SBWT",
  "Sambhava wheat flour": "SBWF",
  "Sambhava wheat rawa": "SBWR",
  // Soaps & Herbal
  "Bath Soap": "BSOP",
  "Multhani matti & Palapak soap": "MMSP",
  "Copper Plate": "CPLT",
  "Copper Water Bottle": "CWBT",
  "Earthen Bottle": "ERBT",
  "Drinking Glass Water Bottle": "DGWB",
  "Face Pack": "FPCK",
  "Multani Mitti Face Pack": "MMFP",
  "SunniPindi": "SNPN",
  "Herbal Head Bath Powder": "HHBP",
  "Shampoo": "SHMP",
  "Natural Henna Powder": "NHNP",
  "Panchagavya Hair oil": "PHRO",
  "Tooth powder": "TPDR",
  "Pain Relief Oil": "PRLO",
  "Lemon Grass Oil": "LGOL",
  "Eucalyptus Oil": "EUCL",
  "Mosquito Repellent Oil": "MROL",
  "Mosrelief Liquid": "MRLQ",
  "Rat Trap": "RTRP",
  "Agarbathi": "AGRB",
  "Phenyl": "PHNL",
  "Herbal Lizard Repellent Spray": "HLZR",
  "Herbal Liquid Dish Wash": "HLDW",
  "Natural Fabric Wash": "NFAB",
  "Kitchen Cleaner Spray": "KTCC",
  "Floor Cleaner": "FLCC",
  "Bathroom Cleaner": "BTRC",
  "Toilet Cleaner": "TLTC",
  "Herbal Cockroach Repellent": "HCKR",
  "Natural Dish Wash Powder": "NDWP",
  "Ashwagandha powder": "ASHW",
  "kitchen waste digester tin": "KWDT",
  "kitchen waste digester powder": "KWDP",
  "Soapnuts": "SPNT",
  "Sheekai": "SHKI",
  "Headache relief oil": "HDRO",
  "Natural Hair Dye": "NHDY",
  // Dry Fruits
  "Almonds": "ALMN",
  "Almonds (Desi-Mamra)": "ALMD",
  "Cashew": "CSHW",
  "Walnuts (Desi-Akhrot)": "WLND",
  "Pumpkin Seed": "PMPS",
  "Saffron": "SAFR",
  "Trifala Churn": "TRFC",
  "Natural Camphor": "NCMP",
  "Amaranth Seeds": "AMRS",
  "Gond Katira": "GNDK",
  "Dry Dates powder": "DDPD",
  "Barley Grass Powder": "BLYG",
  "Amla Powder": "AMLP",
  "Neem Leaves Powder": "NLVS",
  "Wheat Grass Powder": "WGRP",
  "Bilva / Maredu Drink": "BLVD",
  "Nannari Drink": "NNRD",
  "Brahmi Powder": "BHMP",
  "Castor Oil": "CAOL",
  "Dates": "DATE",
  "Flax Seed": "FLXS",
  "Flax Seed Powder": "FLXP",
  "Jaggery": "JAGR",
  "jaggery Small Balls": "JAGB",
  "Jaggery Powder": "JAGP",
  "jaggery Fine Powder": "JAGF",
  "Palm Jaggery": "PJAG",
  "Palm Jaggery (Small Cubes)": "PJAC",
  "Palm Sugar": "PSGR",
  "Date Palm Jaggery": "DPJG",
  "Liquid Eetha Jaggery": "LEJG",
  "Tulasi Ark": "TLAR",
  "6 Rasa Kashaya": "6RKS",
  "Sabja Seeds": "SBJA",
  "Chia Seeds": "CHIA",
  "Kalonji seeds": "KLNJ",
  "Spicy Coconut Podwer": "SCPD",
  // Millets
  "Brown Top Millet": "BTMT",
  "Brown Top Millet Ravva": "BTMR",
  "Brown Top Millet Flour": "BTMF",
  "Kodo Millet": "KDMT",
  "Kodo Millet Ravva": "KDMR",
  "Idly Ravva (Kodo Millet)": "IDKD",
  "Kodo Millet Flour": "KDMF",
  "Kodo Millet Poha": "KDMP",
  "Jonnalu (white)/ Jowar": "JWWH",
  "Jonnalu (white)/ Jowar Flour": "JWJF",
  "Jonnalu (white)/ Jowar Ravva": "JWJR",
  "Jowar (White) Ravva": "JWJR",
  "Idly Ravva (Jowar Millet)": "IDJW",
  "Jowar (White) Flour": "JWJF",
  "Jowar Poha": "JWPH",
  "Foxtail Millet": "FXTM",
  "Foxtail Millet Ravva": "FXMR",
  "Idly Ravva (Foxtail Millet)": "IDFX",
  "Foxtail Millet Flour": "FXMF",
  "Foxtail Millet Poha": "FXMP",
  "Multi Millet": "MMLT",
  "Multi Millet Ravva": "MMRV",
  "Multi Millets Flour": "MMFL",
  "Multi Millet Dosa Mix": "MMDM",
  "Multi Millet Idly Mix": "MMIM",
  "Multigrain Malt Flour": "MGMF",
  "Sprouted Ragi Malt powder": "SRMP",
  "Jowar (Yellow)": "JWYL",
  "Jowar (Yellow) Ravva": "JWYR",
  "Jowar (Yellow) Flour": "JWYF",
  "Finger Millet": "RAGI",
  "Finger Millet Ravva": "RAGR",
  "Finger Millet Flour": "RAGF",
  "Ragi Vermicelly": "RGVR",
  "Finger Millet Poha": "RAGP",
  "Bajra": "BAJA",
  "Bajra Ravva": "BAJR",
  "Bajra Flour": "BAJF",
  "Bajra Poha": "BAJP",
  "Little Millet": "LTMT",
  "Little Millet Ravva": "LTMR",
  "Idly Ravva (Little Millet)": "IDLT",
  "Little Millet Flour": "LTMF",
  "Little Millet Poha": "LTMP",
  "Barnyard Millet": "BYMT",
  "Barnyard Millet Ravva": "BYMR",
  "Idly Ravva (Barnyard Millet)": "IDBY",
  "Barnyard Millet Flour": "BYMF",
  "Barnyard Millet Poha": "BYMP",
  "Proso Millet": "PSMT",
  "Proso Millet Ravva": "PSMR",
  "Proso Millet Flour": "PSMF",
  "Instant Millet Pongal Mix": "IMPM",
  // Spices
  "Cardamom": "CARD",
  "Cloves": "CLVS",
  "Jeera": "JEER",
  "Jeera powder": "JERP",
  "Menthi": "MNTI",
  "Mustard": "MSTD",
  "Pepper": "PPPR",
  "Cinnamon": "CINN",
  "Japatri": "JPTR",
  "Anasa puvvu": "STAR",
  "Kasuri Methi": "KSME",
  "Chilli (Red)": "CHRD",
  "Chilli Powder": "CHPW",
  "Dhaniyalu": "DHNI",
  "Dhaniyalu Powder": "DHNP",
  "Turmeric Powder": "TRMP",
  "Kasturi Turmeric": "KTRM",
  "Turmeric Powder (High Curcumin)": "THCM",
  "Dry Coconut": "DYCN",
  "Tamarind": "TMRD",
  "Rasam Powder": "RSPW",
  "Sambar Powder": "SBPW",
  "Curry Leaf Powder": "CLPW",
  "Kandi Powder": "KNDP",
  "Moringa Powder (Plain)": "MGPW",
  "Moringa Powder spicy": "MGSP",
  "Groundnut Chutney Powder": "GCHP",
  "Pappulapodi": "PPPD",
  "Nalla Karam": "NLKR",
  "Kakarkaya karam": "KKKR",
  "Nuvvulu karam": "NVKR",
  "Verrinuvvula karam": "VNKR",
  "Ginger Powder": "GNGP",
  "Mango Powder": "MGPP",
  "Mango Seed Powder": "MSPW",
  "Rock Salt": "RCSL",
  "Rock Salt (crystal)": "RCSC",
  "Sea Salt": "SESL",
  "Rock Salt (Crystal)": "RCSC",
  "Black Salt": "BKSL",
  "Ginger pickle": "GPKL",
  "Amla pickle": "APKL",
  "Lemon Pickle": "LPKL",
  "Gongura Pickle": "GGPK",
  "Tomato Pickle": "TMPK",
  "Red Chilli Pickle": "RCPK",
  "Mango Pickle": "MGPK",
  "Chintha tokku pickle": "CTPK",
  "Coriander Leaf Pickle": "CRPK",
  "Ragi papad": "RGPD",
  "Rice papad": "RCPD",
  "Millet Mix Papad": "MMPD",
  "Masala papad": "MSPD",
  "Korra Papad": "KRPD",
  "Andukorra Papad": "AKPD",
  "Pulihora mix powder": "PHPW",
  "Organic Dried Tomato Slices": "ODTS",
  "Ajwain": "AJWN",
  "Bay Leaf": "BYLF",
  "Coffee Powder": "COFP",
  "Instant Korra Upma Mix": "IKUM",
  "Instant Arika Upma Mix": "IAUM",
  // Sweets
  "Chikki Groundnut": "CKGN",
  "Chivada": "CHVD",
  "Desi cow ghee pvs": "DCGH",
  "Honey (Farm Collection) Plastic": "HNYP",
  "Honey (Farm Collection) Glass": "HNYG",
  "Forest Honey": "HNYF",
  "Tree Bark Honey": "HNYT",
  "Jonna Laddu": "JLAD",
  "Jonna Muruku": "JMRK",
  "Jonna Nippatta": "JNPT",
  "jowar Spicy Pops": "JWSP",
  "Millet Laddu": "MLAD",
  "Millet Laddu Instant Mix": "MLIM",
  "Millet Muruku": "MMRK",
  "Millet Nippattu": "MNPT",
  "Nuvvula Laddu": "NLAD",
  "Rice Nippattu": "RNPT",
  "Rice Muruku": "RMRK",
  "Sajja Vada Spicy": "SVSP",
  "Sajja Vada Sweet": "SVSW",
  "Groundnut Masala": "GNMS",
  "Horsegram masala": "HGMS",
  "Groundnut Laddu": "GLAD",
  "Sweet Jowar Pops": "SJPP",
  "Masala Borugulu": "MBRG",
  "Patnalu": "PTNL",
  "Natural Sugar": "NSGR",
  "Minapa Laddu": "MNLD",
  "Jowar rotti": "JRTI",
  "Bajra rotti": "BRTI",
  "White Gingely Chikki": "WGCK",
  "Flaxseed Burfie": "FXBR",
  "Red Rice Ariselu": "RRAR",
  "Borugulu Laddu": "BRLD",
  "White Gingely Laddu": "WGLD",
  "Multi Millet Laddu": "MMLD",
  "Besan murukulu": "BSMR",
  "Jonna Murukulu": "JMRL",
  "Black Rice Arisalu": "BRAR",
  "Khandsari sugar": "KSGR",
  "Coconut Laddu": "CNLD",
  "Pesara Laddu": "PSLD",
  "Ragi Muruku": "RGMR",
  // Books
  "Siridhanyalatho sampoorna Arogyam": "BK01",
  "Siridhanyalu (sampoorna Arogyam)": "BK02",
  "Siridhanyalu (Millets) Food that Heals": "BK03",
  // Water filter
  "Water Filter-SS316 - E 23": "WFE2",
  "Lime Stone": "LMST",
  "Coal": "COAL",
  "Bricks": "BRCK",
  "Sand": "SAND",
  "316 Steel Mesh": "SMSH",
  "316 Steel Mesh (Round)": "SMRD",
  "Water Filter Stand": "WFST",
  "Mineral Bag": "MBAG",
  "Water Filter Stand - MS (Powder Coated)": "WFMS",
  "Water Filter Stand - SS (Stainless Steel)": "WFSS",
  "cartridge (filled)": "CART",
  // Miscellaneous
  "Iron Kadai (Wooden Handle)-Induction": "IKWI",
  "Iron Kadai (Wooden Handle)": "IKWH",
  "Iron Kadai (Steel Handle)-Induction": "IKSI",
  "Iron Kadai (Steel Handle)": "IKSH",
  "Iron Dosa Tawa (Wooden Handle)": "IDWH",
  "Iron Roti Tawa (Wooden Handle)": "IRWH",
  "Iron Amboli Tawa": "IATW",
  "Iron Appam Chatti Tawa": "IACT",
  "Iron Frying Pan (Wooden Handle)": "IFPW",
  "Iron Ponganalu Kadai (Wooden Handle)": "IPWH",
  "Iron Ponganalu Kadai (Steel Handle)": "IPSH",
  "Iron Frying Pan (Steel Handle)": "IFPS",
};

// Auto-derive a code for any family that isn't in the map.
// Picks the first letter of each significant word, capped at 4.
const autoCode = (name: string): string => {
  const words = name
    .replace(/[^A-Za-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !["and", "or", "the", "of", "for", "to", "a", "with"].includes(w.toLowerCase()));
  let raw = words
    .slice(0, 4)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (raw.length < 3) {
    raw = (words[0] ?? "PRD").slice(0, 3).toUpperCase();
  }
  return raw.slice(0, 4);
};

// Family keys sorted longest-first so prefix matching never lumps a
// long family ("Coconut Oil") into a shorter accidental match.
const FAMILY_KEYS_SORTED = Object.keys(FAMILY_CODE_MAP).sort((a, b) => b.length - a.length);

// Resolve a row's name -> { familyName, qualifier }. The qualifier is the
// trailing text (often a scent / flavour / sub-type) which becomes a
// variant axis. e.g.
//   "Bath Soap (Jasmine)"          -> { Bath Soap, Jasmine }
//   "Agarbathi Sandal wood"        -> { Agarbathi, Sandal wood }
//   "Coconut Oil (Plastic Bottle)" -> { Coconut Oil, Plastic Bottle }
const resolveFamily = (
  fullName: string,
  containerHint: string | null
): { familyName: string; qualifier: string | null } => {
  for (const key of FAMILY_KEYS_SORTED) {
    if (fullName.toLowerCase().startsWith(key.toLowerCase())) {
      let remainder = fullName.slice(key.length).trim();
      // Strip leading punctuation/parentheses from the remainder.
      remainder = remainder
        .replace(/^[-:,\/]+\s*/, "")
        .replace(/^\((.*)\)$/, "$1")
        .replace(/^\(/, "")
        .replace(/\)$/, "")
        .trim();
      // Container already lives in its own slot (grade) - don't echo it.
      return { familyName: key, qualifier: remainder || null };
    }
  }
  // Unknown family: no qualifier, container already captured separately.
  return { familyName: fullName, qualifier: null };
};

// ============================================================ category ===

const CATEGORY_PATTERNS: { re: RegExp; cat: Category }[] = [
  { re: /^Edible Oils/i, cat: "Edible Oils" },
  { re: /^Rice.*Cereals.*Pulses/i, cat: "Rice Cereals & Pulses" },
  { re: /^Cosmotic.*Herbal/i, cat: "Cosmetics & Herbal" },
  { re: /^Dry Fruits/i, cat: "Dry Fruits & Health" },
  { re: /^Millets/i, cat: "Millets" },
  { re: /^Spices.*Masala.*Pickles/i, cat: "Spices & Pickles" },
  { re: /^Sweets.*Savories/i, cat: "Sweets & Savories" },
  { re: /^Books/i, cat: "Books" },
  { re: /^Water Filter/i, cat: "Water Filter" },
  { re: /Miscellenous|Miscellaneous/i, cat: "Miscellaneous" },
];

// ============================================================ parser ===

const COL_INDEX_MRP = {
  primaryCode: 0,
  productCode: 1,
  name: 2,
  hsn: 3,
  size: 4,
  qty: 5,
  mrp: 6,
  gst: 7,
  expiry: 8,
  stock: 9,
};

const COL_INDEX_DEALER = {
  primaryCode: 0,
  productCode: 1,
  name: 2,
  hsn: 3,
  size: 4,
  qty: 5,
  dealerPrice: 6,
  margin: 7,
  mrp: 8,
  gst: 9,
  expiry: 10,
  stock: 11,
};

interface RawRow {
  productCode: string;
  name: string;
  hsn: string;
  size: string;
  mrp?: number;
  dealerPrice?: number;
  expiry: string;
  gst: number;
  inStock: boolean;
  category: Category;
}

const isHeaderRow = (row: unknown[]) => {
  const a = String(row[0] ?? "").trim();
  const b = String(row[1] ?? "").trim();
  return a === "Code No" || b === "Code No";
};

// True when the row looks like a category banner - just a single text cell
// (in col 0 or col 1) that matches one of our known categories.
const isCategoryRow = (row: unknown[]) => {
  const a = String(row[0] ?? "").trim();
  const b = String(row[1] ?? "").trim();
  const banner = a || b;
  if (!banner) return false;
  // It's a banner only if exactly one cell is filled with a category-like
  // value and everything else is empty.
  const filled = row.filter((c) => String(c ?? "").trim() !== "").length;
  if (filled > 1) return false;
  return CATEGORY_PATTERNS.some((p) => p.re.test(banner));
};

const detectCategory = (banner: string): Category => {
  for (const p of CATEGORY_PATTERNS) if (p.re.test(banner)) return p.cat;
  return "Miscellaneous";
};

const parseFile = (
  path: string,
  isDealer: boolean
): RawRow[] => {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const out: RawRow[] = [];
  let currentCategory: Category = "Edible Oils";
  for (const sheetName of wb.SheetNames) {
    // The dealer workbook contains a second sheet named exactly "Sheet1"
    // (the main one is "Sheet1  (5)"). It's a partial duplicate of soaps,
    // millets and coffee with a completely different column layout. The
    // first sheet already covers all those SKUs, so we skip the second.
    if (sheetName === "Sheet1") continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: "",
    }) as unknown[][];
    for (const row of rows) {
      if (isHeaderRow(row)) continue;
      if (isCategoryRow(row)) {
        const banner = String(row[0] ?? "").trim() || String(row[1] ?? "").trim();
        currentCategory = detectCategory(banner);
        continue;
      }
      // "Sheet1" (the 2nd sheet in dealer file) has a different layout - it
      // starts with the product code directly in col 0 (no primary code).
      // We detect it heuristically by checking if col 0 looks like a code.
      const code0 = String(row[0] ?? "").trim();
      const code1 = String(row[1] ?? "").trim();
      let pc = code1; // by default the OS code is in col 1
      let nameCell = String(row[2] ?? "");
      let hsnCell = String(row[3] ?? "");
      let sizeCell = String(row[4] ?? "");
      if (!code1 && /^[A-Z]+\d/i.test(code0)) {
        // Looks like the 2nd sheet layout (no primary code column)
        pc = code0;
        nameCell = String(row[1] ?? "");
        hsnCell = String(row[2] ?? "");
        sizeCell = String(row[3] ?? "");
      }
      if (!pc || !nameCell) continue;
      // Drop any row whose "code" is actually a category banner (this can
      // happen when the banner row is partially blank).
      if (CATEGORY_PATTERNS.some((p) => p.re.test(pc))) continue;
      // Fix the typo "0S054" -> "OS054"
      pc = pc.replace(/^0(S\d+)/, "O$1").toUpperCase();
      const name = cleanName(nameCell);
      if (!name) continue;
      // Skip rows whose "name" is actually a size token (parser misalignment).
      if (/^\d+\s*(gms?|kg|kgs|ml|l|ltr|lit|cm|inch|no|nos|pcs?)$/i.test(name)) continue;
      const hsn = norm(hsnCell);
      const size = norm(sizeCell);
      let mrp: number | undefined;
      let dealerPrice: number | undefined;
      let gst = 0;
      let expiry = "";
      let inStock = true;
      if (isDealer) {
        if (!code1 && /^[A-Z]+\d/i.test(code0)) {
          // Sheet1 (second sheet) - dealer price is at index 3 in that layout
          dealerPrice = numF(row[3]);
          mrp = numF(row[5]);
          gst = numF(row[6]);
          expiry = norm(row[7]);
          inStock = String(row[8] ?? "").toLowerCase().includes("in stock");
        } else {
          dealerPrice = numF(row[COL_INDEX_DEALER.dealerPrice]);
          mrp = numF(row[COL_INDEX_DEALER.mrp]);
          gst = numF(row[COL_INDEX_DEALER.gst]);
          expiry = norm(row[COL_INDEX_DEALER.expiry]);
          inStock = String(row[COL_INDEX_DEALER.stock] ?? "").toLowerCase().includes("in stock");
        }
      } else {
        mrp = numF(row[COL_INDEX_MRP.mrp]);
        gst = numF(row[COL_INDEX_MRP.gst]);
        expiry = norm(row[COL_INDEX_MRP.expiry]);
        inStock = String(row[COL_INDEX_MRP.stock] ?? "").toLowerCase().includes("in stock");
      }
      if (!Number.isFinite(mrp ?? NaN) && !Number.isFinite(dealerPrice ?? NaN)) continue;
      out.push({
        productCode: pc,
        name,
        hsn,
        size,
        mrp,
        dealerPrice,
        expiry,
        gst,
        inStock,
        category: currentCategory,
      });
    }
  }
  return out;
};

// ============================================================ joiner ===

const merge = (mrpRows: RawRow[], dealerRows: RawRow[]): Row[] => {
  const byCode = new Map<string, Row>();
  for (const r of mrpRows) {
    if (!Number.isFinite(r.mrp ?? NaN)) continue;
    byCode.set(r.productCode, {
      category: r.category,
      productCode: r.productCode,
      name: r.name,
      hsn: r.hsn,
      size: r.size,
      mrp: r.mrp!,
      dealerPrice: r.mrp!, // fallback: same as MRP if no dealer row
      expiry: r.expiry,
      gst: r.gst,
      inStock: r.inStock,
    });
  }
  for (const r of dealerRows) {
    const existing = byCode.get(r.productCode);
    if (existing) {
      if (Number.isFinite(r.dealerPrice ?? NaN)) existing.dealerPrice = r.dealerPrice!;
      if (existing.name !== r.name && r.name.length > existing.name.length) {
        // Prefer the dealer file's longer (less-truncated) name
        existing.name = r.name;
      }
    } else if (Number.isFinite(r.dealerPrice ?? NaN)) {
      byCode.set(r.productCode, {
        category: r.category,
        productCode: r.productCode,
        name: r.name,
        hsn: r.hsn,
        size: r.size,
        mrp: r.mrp ?? r.dealerPrice!,
        dealerPrice: r.dealerPrice!,
        expiry: r.expiry,
        gst: r.gst,
        inStock: r.inStock,
      });
    }
  }
  return Array.from(byCode.values());
};

// ============================================================ family grouping ===

interface Family {
  code: string;
  baseName: string;
  category: Category;
  hsn: string;
  gst: number;
  variants: VariantSpec[];
}

interface VariantSpec {
  productCode: string; // OSxxx - source row
  containerHint: string | null;
  qualifier: string | null; // scent/flavour/sub-type (Bath Soap -> "Jasmine")
  size: string;
  sizeLabel: string;
  sizeUnit: string;
  sizeMagnitude: number;
  mrp: number;
  dealerPrice: number;
  inStock: boolean;
  expiry: string;
}

// Some product names contain BOTH the family identifier AND a container
// suffix that should NOT collapse two distinct families into one. We
// strip recognized container hints into the "container" field and
// everything else stays in the family base name.
const KNOWN_CONTAINERS = [
  /\(Plastic Bottle Only\)$/i,
  /\(Plastic Bottle\)$/i,
  /\(Tin\)$/i,
  /\(Glass Bottle Only\)$/i,
  /\(Glass Bottle\)$/i,
  /\(Glass\)$/i,
  /\(Plastic\)$/i,
];
const stripContainer = (name: string): { base: string; container: string | null } => {
  for (const re of KNOWN_CONTAINERS) {
    const m = name.match(re);
    if (m) {
      return {
        base: name.slice(0, name.length - m[0].length).trim(),
        container: m[0].replace(/[()]/g, "").trim(),
      };
    }
  }
  return { base: name, container: null };
};

const buildFamilies = (rows: Row[]): Family[] => {
  const families = new Map<string, Family>();
  for (const r of rows) {
    // Step 1: remove any known container suffix.
    const { base: baseAfterContainer, container } = stripContainer(r.name);
    // Step 2: prefix-match against the curated family map. This collapses
    // "Bath Soap (Jasmine)" + "Bath Soap (Vetivert)" into a single family.
    const { familyName, qualifier } = resolveFamily(baseAfterContainer, container);
    const familyKey = `${r.category}::${familyName.toLowerCase()}`;
    let fam = families.get(familyKey);
    if (!fam) {
      const code = FAMILY_CODE_MAP[familyName] ?? autoCode(familyName);
      fam = {
        code,
        baseName: familyName,
        category: r.category,
        hsn: r.hsn,
        gst: r.gst,
        variants: [],
      };
      families.set(familyKey, fam);
    }
    const sz = parseSize(r.size);
    fam.variants.push({
      productCode: r.productCode,
      containerHint: container,
      qualifier,
      size: r.size,
      sizeLabel: sz.label,
      sizeUnit: sz.unit,
      sizeMagnitude: sz.magnitude,
      mrp: r.mrp,
      dealerPrice: r.dealerPrice,
      inStock: r.inStock,
      expiry: r.expiry,
    });
  }
  // Sort variants by size (descending magnitude) within each family
  for (const f of families.values()) {
    f.variants.sort((a, b) => {
      const sizeRank = (u: string) =>
        u === "kg" ? 1000 : u === "l" ? 1000 : u === "g" ? 1 : u === "ml" ? 1 : 0;
      const av = a.sizeMagnitude * sizeRank(a.sizeUnit);
      const bv = b.sizeMagnitude * sizeRank(b.sizeUnit);
      return bv - av;
    });
  }
  return Array.from(families.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.baseName.localeCompare(b.baseName);
  });
};

// ============================================================ DB writes ===

const productTypeForCategory = (c: Category): string => {
  switch (c) {
    case "Water Filter":
    case "Miscellaneous":
      return "consumable";
    case "Books":
      return "consumable";
    default:
      return "finished";
  }
};

export const variantSku = (familyCode: string, idx: number, v: VariantSpec): string => {
  const sizeBits = v.sizeUnit
    ? `${v.sizeMagnitude}${v.sizeUnit}`.toUpperCase().replace(/\./g, "")
    : "";
  const containerBits = v.containerHint
    ? v.containerHint.match(/Plastic/i)
      ? "PL"
      : v.containerHint.match(/Glass/i)
        ? "GL"
        : v.containerHint.match(/Tin/i)
          ? "TN"
          : ""
    : "";
  // Compress the qualifier (scent/flavour) into 3 letters for the SKU.
  const qualBits = v.qualifier
    ? v.qualifier
        .replace(/[^A-Za-z]/g, "")
        .slice(0, 3)
        .toUpperCase()
    : "";
  return [familyCode, qualBits, sizeBits, containerBits, String(idx + 1).padStart(2, "0")]
    .filter(Boolean)
    .join("-");
};

/** De-dup family codes the same way importAll does (curated map collisions). */
export const dedupFamilyCodes = (families: Family[]): void => {
  const seenCodes = new Set<string>();
  for (const f of families) {
    let c = f.code;
    let i = 0;
    while (seenCodes.has(c)) {
      i++;
      c = f.code.slice(0, 3) + i;
    }
    f.code = c;
    seenCodes.add(c);
  }
};

/**
 * Map variant SKU → price-list Code No (OS/RC/CH…) using the same family/SKU
 * logic as importAll. Each row's productCode is the variant barcode.
 */
export const buildSkuBarcodeMap = (
  mrpPath: string,
  dealerPath: string
): Map<string, string> => {
  const mrpRows = parseFile(mrpPath, false);
  const dealerRows = parseFile(dealerPath, true);
  const merged = merge(mrpRows, dealerRows);
  const families = buildFamilies(merged);
  dedupFamilyCodes(families);
  const map = new Map<string, string>();
  for (const f of families) {
    for (let i = 0; i < f.variants.length; i++) {
      const v = f.variants[i];
      const sku = variantSku(f.code, i, v);
      map.set(sku, v.productCode);
    }
  }
  return map;
};

const importAll = async () => {
  console.log("Parsing MRP file…");
  const mrpRows = parseFile(MRP_FILE, false);
  console.log(`  ${mrpRows.length} rows`);
  console.log("Parsing Dealer file…");
  const dealerRows = parseFile(DEALER_FILE, true);
  console.log(`  ${dealerRows.length} rows`);

  console.log("Merging…");
  const merged = merge(mrpRows, dealerRows);
  console.log(`  ${merged.length} unique product codes`);

  console.log("Building families…");
  const families = buildFamilies(merged);
  console.log(`  ${families.length} families`);

  // Wipe existing - order matters: dependents first to satisfy FKs.
  console.log("Wiping existing products, variants, price lists…");
  await db.dispatchOrder.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.deleteMany();
  await db.packingSlipItem.deleteMany();
  await db.packingSlip.deleteMany();
  await db.pickListItem.deleteMany();
  await db.pickList.deleteMany();
  await db.salesOrderItem.deleteMany();
  await db.salesOrder.deleteMany();
  await db.quoteRevision.deleteMany();
  await db.quoteItem.deleteMany();
  await db.quote.deleteMany();
  await db.priceListItem.deleteMany();
  await db.grn.deleteMany();
  await db.purchaseOrderItem.deleteMany();
  await db.purchaseOrder.deleteMany();
  await db.workOrder.deleteMany();
  await db.productionOrder.deleteMany();
  await db.bomItem.deleteMany();
  await db.bom.deleteMany();
  await db.stockLedger.deleteMany();
  await db.bin.updateMany({ data: { productId: null, qty: 0, reservedQty: 0 } });
  await db.productVariant.deleteMany();
  await db.product.deleteMany();

  // Get the two seeded price lists
  const retail = await db.priceList.findUnique({ where: { code: "RETAIL" } });
  const dealer = await db.priceList.findUnique({ where: { code: "DEALER" } });
  if (!retail || !dealer) {
    throw new Error("Run the main db:seed first to create RETAIL + DEALER price lists.");
  }

  dedupFamilyCodes(families);

  // Write products + variants + prices
  let productCount = 0;
  let variantCount = 0;
  let priceCount = 0;
  for (const f of families) {
    // For families with just ONE variant, we still keep the variant for
    // consistency - simpler resolver path.
    // Pick a representative variant to seed Product.sellingPrice/costPrice.
    // Prefer one with a real MRP; fall back to dealer or any non-zero.
    const repVariant =
      f.variants.find((v) => v.mrp > 0) ??
      f.variants.find((v) => v.dealerPrice > 0) ??
      f.variants[0];
    const repMrp = repVariant.mrp > 0 ? repVariant.mrp : Math.round(repVariant.dealerPrice * 1.2);
    const repDealer = repVariant.dealerPrice > 0 ? repVariant.dealerPrice : repMrp;
    const productSku = f.code;
    const uom =
      repVariant.sizeUnit === "kg" || repVariant.sizeUnit === "g"
        ? "Kg"
        : repVariant.sizeUnit === "l" || repVariant.sizeUnit === "ml"
          ? "Ltr"
          : "Nos";
    const product = await db.product.create({
      data: {
        sku: productSku,
        name: f.baseName,
        type: productTypeForCategory(f.category),
        uom,
        barcode: `BC-${productSku}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        state: "active",
        category: f.category,
        hsn: f.hsn || "0000",
        costPrice: Math.round(repDealer * 0.7),
        sellingPrice: repMrp,
        reorderLevel: 5,
        stockOnHand: 0,
        batchTracked: false,
      },
    });
    productCount++;

    for (let i = 0; i < f.variants.length; i++) {
      const v = f.variants[i];
      const mrp = v.mrp > 0 ? v.mrp : repMrp;
      const dealerPrice = v.dealerPrice > 0 ? v.dealerPrice : mrp;
      const sku = variantSku(f.code, i, v);
      // The schema's variant axes are size/color/grade.
      //   - "size"  : 5 L / 500 ml / 100 g …
      //   - "color" : scent / flavour / sub-type (the parenthetical bit
      //               that distinguishes Bath Soap (Jasmine) from
      //               Bath Soap (Vetivert))
      //   - "grade" : container/packaging hint (Plastic / Glass / Tin)
      const variant = await db.productVariant.create({
        data: {
          productId: product.id,
          sku,
          barcode: v.productCode,
          uom: "pc",
          size: v.sizeLabel,
          color: v.qualifier ?? null,
          grade: v.containerHint ?? null,
          stockOnHand: Math.floor(50 + Math.random() * 150),
          active: v.inStock,
          costPriceOverride: Math.round(dealerPrice * 0.7),
          sellingPriceOverride: mrp,
        },
      });
      variantCount++;

      // RETAIL price (MRP)
      await db.priceListItem.create({
        data: {
          priceListId: retail.id,
          productId: product.id,
          variantId: variant.id,
          price: mrp,
          minQty: 1,
        },
      });
      priceCount++;
      // DEALER price (only insert when it differs from MRP)
      if (dealerPrice && dealerPrice !== mrp) {
        await db.priceListItem.create({
          data: {
            priceListId: dealer.id,
            productId: product.id,
            variantId: variant.id,
            price: dealerPrice,
            minQty: 1,
          },
        });
        priceCount++;
      }
    }
  }

  // Update the parent product.stockOnHand to be the sum of its variants
  // so the Products list still shows a sensible aggregate.
  const productsForSync = await db.product.findMany({
    include: { variants: { select: { stockOnHand: true } } },
  });
  for (const p of productsForSync) {
    const total = p.variants.reduce((s, v) => s + v.stockOnHand, 0);
    await db.product.update({ where: { id: p.id }, data: { stockOnHand: total } });
  }

  console.log("\n=== Import complete ===");
  console.log(`Products:           ${productCount}`);
  console.log(`Variants:           ${variantCount}`);
  console.log(`Price list rows:    ${priceCount}`);
  console.log("\nFamily code preview (top 25 by variant count):");
  const ranked = [...families].sort((a, b) => b.variants.length - a.variants.length);
  for (const f of ranked.slice(0, 25)) {
    console.log(`  ${f.code.padEnd(6)} ${f.baseName.padEnd(40)} (${f.variants.length} variants, ${f.category})`);
  }
  console.log("\nCategory totals:");
  const catCounts = new Map<string, { products: number; variants: number }>();
  for (const f of families) {
    const c = catCounts.get(f.category) ?? { products: 0, variants: 0 };
    c.products++;
    c.variants += f.variants.length;
    catCounts.set(f.category, c);
  }
  for (const [cat, c] of catCounts.entries()) {
    console.log(`  ${cat.padEnd(28)} ${c.products} products / ${c.variants} variants`);
  }
};

if (process.argv[1]?.replace(/\\/g, "/").includes("import-pricelists")) {
  importAll()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
