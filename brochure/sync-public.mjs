/** Copy brochure assets to erp-portal/public/brochure for preview at /brochure/index.html */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dst = path.resolve(root, "../erp-portal/public/brochure");

fs.mkdirSync(path.join(dst, "screenshots"), { recursive: true });
fs.copyFileSync(path.join(root, "brochure.html"), path.join(dst, "index.html"));
for (const f of fs.readdirSync(path.join(root, "screenshots"))) {
  if (f.endsWith(".png")) {
    fs.copyFileSync(path.join(root, "screenshots", f), path.join(dst, "screenshots", f));
  }
}
console.log(`Synced to ${dst}`);
