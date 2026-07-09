// Inline SVG art used by category cards, hero sections and product
// thumbnails. Lifted verbatim from the static mockup so the visual
// brand stays identical. They are intentionally not 1:1 photorealistic
// renders - the design language calls for stylised illustrations of
// pots, sacks and grain piles.

import type { ReactElement } from "react";

const wrap = (children: ReactElement): ReactElement => (
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    {children}
  </svg>
);

export const CategoryIconOil = (): ReactElement =>
  wrap(
    <>
      <rect x="42" y="15" width="16" height="8" rx="2" fill="#854d0e" />
      <path
        d="M35 30 L65 30 L70 85 L30 85 Z"
        fill="#eab308"
        stroke="#ca8a04"
        strokeWidth={2}
      />
      <path
        d="M30 85 Q 50 92 70 85"
        stroke="#ca8a04"
        strokeWidth={2}
        fill="none"
      />
      <circle cx="50" cy="55" r="14" fill="#fafafa" stroke="#eaeae5" strokeWidth={1} />
      <path d="M50 48 Q 53 55 50 62 Q 47 55 50 48" fill="#ca8a04" />
      <ellipse cx="25" cy="80" rx="3" ry="5" fill="#44403c" transform="rotate(30 25 80)" />
      <ellipse cx="75" cy="78" rx="3" ry="5" fill="#44403c" transform="rotate(-25 75 78)" />
      <ellipse cx="50" cy="88" rx="2.5" ry="4" fill="#44403c" />
    </>
  );

export const CategoryIconSack = (): ReactElement =>
  wrap(
    <>
      <path
        d="M25 45 C25 25, 75 25, 75 45 L78 80 C78 88, 22 88, 22 80 Z"
        fill="#d7ba8e"
        stroke="#a18256"
        strokeWidth={2}
      />
      <path d="M22 80 Q 50 88 78 80" stroke="#a18256" strokeWidth={2} fill="none" />
      <path d="M25 45 Q 50 50 75 45" stroke="#a18256" strokeWidth={1.5} fill="none" />
      <ellipse cx="50" cy="40" rx="24" ry="8" fill="#a18256" />
      <ellipse cx="50" cy="38" rx="22" ry="7" fill="#fafaf9" />
      <circle cx="50" cy="38" r="2" fill="#ca8a04" />
      <ellipse cx="50" cy="82" rx="24" ry="6" fill="#fef08a" opacity={0.8} />
    </>
  );

export const CategoryIconMillets = (): ReactElement =>
  wrap(
    <>
      <circle cx="50" cy="50" r="38" fill="none" stroke="#eaeae5" strokeDasharray="5 5" />
      <circle cx="50" cy="22" r="11" fill="#eab308" stroke="#ca8a04" strokeWidth={1.5} />
      <circle cx="74" cy="36" r="11" fill="#ca8a04" stroke="#a16207" strokeWidth={1.5} />
      <circle cx="74" cy="64" r="11" fill="#1e4620" stroke="#122b14" strokeWidth={1.5} />
      <circle cx="50" cy="78" r="11" fill="#d7ba8e" stroke="#a18256" strokeWidth={1.5} />
      <circle cx="26" cy="64" r="11" fill="#e27d60" stroke="#c96549" strokeWidth={1.5} />
      <circle cx="26" cy="36" r="11" fill="#85cdb0" stroke="#64ad90" strokeWidth={1.5} />
    </>
  );

export const CategoryIconCookies = (): ReactElement =>
  wrap(
    <>
      <circle cx="45" cy="45" r="20" fill="#cca385" stroke="#b08669" strokeWidth={2} />
      <circle cx="45" cy="45" r="16" fill="none" stroke="#b08669" strokeDasharray="4 4" />
      <circle cx="38" cy="38" r="2.5" fill="#44403c" />
      <circle cx="52" cy="42" r="2" fill="#44403c" />
      <circle cx="42" cy="50" r="2.5" fill="#44403c" />
      <circle cx="60" cy="58" r="18" fill="#cca385" stroke="#b08669" strokeWidth={1.5} opacity={0.8} />
    </>
  );

export const CategoryIconSpices = (): ReactElement =>
  wrap(
    <>
      <path d="M15 75 Q 50 35 85 75 Z" fill="#ca8a04" />
      <path d="M30 75 Q 60 40 90 75 Z" fill="#b91c1c" opacity={0.9} />
      <path d="M10 75 Q 35 50 60 75 Z" fill="#1e4620" opacity={0.8} />
      <rect x="40" y="65" width="8" height="20" rx="2" fill="#7c2d12" transform="rotate(45 44 75)" />
    </>
  );

export const CategoryIconNuts = (): ReactElement =>
  wrap(
    <>
      <ellipse cx="50" cy="70" rx="35" ry="12" fill="#cca385" stroke="#b08669" strokeWidth={2} />
      <path d="M40 60 Q 45 50 50 60" stroke="#fef08a" strokeWidth={6} strokeLinecap="round" fill="none" />
      <path d="M50 55 Q 55 45 60 55" stroke="#fafaf9" strokeWidth={6} strokeLinecap="round" fill="none" />
      <path d="M32 63 Q 36 53 41 63" stroke="#fef3c7" strokeWidth={5} strokeLinecap="round" fill="none" />
      <path d="M58 63 Q 63 53 68 63" stroke="#fef3c7" strokeWidth={5} strokeLinecap="round" fill="none" />
    </>
  );

export const CategoryIconSoap = (): ReactElement =>
  wrap(
    <>
      <rect x="25" y="55" width="50" height="20" rx="4" fill="#f0fdf4" stroke="#16a34a" strokeWidth={2} />
      <rect x="28" y="42" width="44" height="18" rx="4" fill="#fef2f2" stroke="#dc2626" strokeWidth={1.5} />
      <rect x="31" y="30" width="38" height="16" rx="4" fill="#fef9c3" stroke="#ca8a04" strokeWidth={1.5} />
      <path
        d="M18 55 C12 45, 20 40, 22 42 C20 48, 22 52, 18 55 Z"
        fill="#16a34a"
        opacity={0.8}
      />
    </>
  );

export const CategoryIconEco = (): ReactElement =>
  wrap(
    <>
      <circle cx="50" cy="50" r="38" fill="none" stroke="#eaeae5" strokeDasharray="5 5" />
      <circle cx="50" cy="22" r="10" fill="#fafaf9" stroke="#78716c" strokeWidth={1.5} />
      <circle cx="74" cy="36" r="10" fill="#fef08a" stroke="#ca8a04" strokeWidth={1.5} />
      <circle cx="74" cy="64" r="10" fill="#f0fdf4" stroke="#16a34a" strokeWidth={1.5} />
      <circle cx="50" cy="78" r="10" fill="#fafaf9" stroke="#78716c" strokeWidth={1.5} />
      <circle cx="26" cy="64" r="10" fill="#fef3c7" stroke="#eab308" strokeWidth={1.5} />
      <circle cx="26" cy="36" r="10" fill="#fafaf9" stroke="#78716c" strokeWidth={1.5} />
    </>
  );

export const CategoryIconJaggery = (): ReactElement =>
  wrap(
    <>
      <path
        d="M30 40 Q 50 35 70 40 L75 75 Q75 88 50 88 Q25 88 25 75 Z"
        fill="#78350f"
        stroke="#451a03"
        strokeWidth={2}
      />
      <ellipse cx="50" cy="40" rx="20" ry="6" fill="#ca8a04" />
      <path d="M48 40 L48 62 C48 65, 52 65, 52 62 L52 40 Z" fill="#ca8a04" />
      <circle cx="50" cy="62" r="3" fill="#ca8a04" />
    </>
  );

export const CategoryIconUtilities = (): ReactElement =>
  wrap(
    <>
      <rect x="42" y="15" width="16" height="10" rx="1" fill="#78716c" />
      <path d="M32 32 L68 32 L72 85 L28 85 Z" fill="#fafaf9" stroke="#78716c" strokeWidth={2} />
      <path d="M26 40 Q 50 34 74 40 L70 58 Q 50 62 30 58 Z" fill="#d7ba8e" opacity={0.9} />
      <circle cx="50" cy="68" r="10" fill="none" stroke="#78716c" strokeWidth={1.5} />
      <path d="M46 68 L54 68 M50 64 L50 72" stroke="#78716c" strokeWidth={1.5} />
    </>
  );

// Combo / craft-bag generic packaging used on best-seller and combo
// product cards in the mockup.
export const PackagingCraftBag = (): ReactElement =>
  wrap(
    <>
      <path
        d="M30 28 L70 28 L72 85 L28 85 Z"
        fill="#d7ba8e"
        stroke="#a18256"
        strokeWidth={2}
      />
      <path d="M30 28 L70 28 L66 18 L34 18 Z" fill="#fef3c7" stroke="#a18256" strokeWidth={1.5} />
      <ellipse cx="50" cy="50" rx="14" ry="7" fill="#1e4620" opacity={0.85} />
      <text
        x="50"
        y="54"
        textAnchor="middle"
        fontSize="6"
        fill="#fef9c3"
        fontWeight={700}
      >
        ORGANIC
      </text>
    </>
  );

export const PackagingComboBags = (): ReactElement =>
  wrap(
    <>
      <path d="M22 30 L48 30 L50 80 L20 80 Z" fill="#1e4620" stroke="#0f3110" strokeWidth={2} />
      <path d="M50 30 L78 30 L80 80 L48 80 Z" fill="#ca8a04" stroke="#a16207" strokeWidth={2} />
      <ellipse cx="34" cy="55" rx="9" ry="5" fill="#fef9c3" />
      <ellipse cx="64" cy="55" rx="9" ry="5" fill="#fef2f2" />
      <path d="M22 30 L78 30 L72 18 L28 18 Z" fill="#22251f" />
    </>
  );

export const PackagingBottleOil = (): ReactElement =>
  wrap(
    <>
      <rect x="42" y="14" width="16" height="10" rx="2" fill="#7c2d12" />
      <path d="M30 28 L70 28 L75 86 L25 86 Z" fill="#fef9c3" stroke="#ca8a04" strokeWidth={2} />
      <ellipse cx="50" cy="55" rx="14" ry="6" fill="#ca8a04" opacity={0.85} />
      <text x="50" y="57" textAnchor="middle" fontSize="5" fill="#7c2d12" fontWeight={700}>
        OIL
      </text>
    </>
  );

export const PackagingSoapPack = (): ReactElement =>
  wrap(
    <>
      <rect x="22" y="35" width="56" height="36" rx="6" fill="#fef2f2" stroke="#dc2626" strokeWidth={2} />
      <text x="50" y="58" textAnchor="middle" fontSize="9" fill="#dc2626" fontWeight={700}>
        AYUR
      </text>
      <path d="M22 35 L78 35 L78 28 L22 28 Z" fill="#16a34a" />
    </>
  );

// Heart icon used on product wishlist toggles.
export const HeartIcon = ({ filled = false }: { filled?: boolean }): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={2}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);

export const CartIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

export const SearchIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const UserIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-9 2.34-9 5v3h18v-3c0-2.66-4.58-5-9-5Z" />
  </svg>
);

export const TrashIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  </svg>
);

export const ChevronLeftIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export const ChevronRightIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const ChevronUpIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="m18 15-6-6-6 6" />
  </svg>
);

export const CheckIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const MenuIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const CloseIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

// Brand banyan tree mark - intentionally simplified compared to the
// static mockup which used a hand-illustrated SVG. Keeps weight low.
export const BanyanTreeMark = (): ReactElement => (
  <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M32 6c-7 4-9 11-7 17-6 0-10 5-10 11s5 11 11 11h2v8c-3 0-6 1-6 3h20c0-2-3-3-6-3v-8h2c6 0 11-5 11-11s-4-11-10-11c2-6 0-13-7-17Z"
      fill="#1e4620"
    />
    <path d="M28 47v6M36 47v6M32 47v8" stroke="#7c2d12" strokeWidth={1.5} />
  </svg>
);
