#!/usr/bin/env node
/**
 * Build manufacturing-multi-machine-parallel.pdf from markdown
 *
 *   cd docs && npm run pdf:multi-machine
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mdPath = join(__dirname, "manufacturing-multi-machine-parallel.md");
const cssPath = join(__dirname, "erp-user-manual-print.css");
const htmlPath = join(__dirname, "manufacturing-multi-machine-parallel.html");
const pdfPath = join(__dirname, "manufacturing-multi-machine-parallel.pdf");
const rootPdf = join(__dirname, "..", "PVS-Multi-Machine-Manufacturing.pdf");

marked.setOptions({ gfm: true, breaks: false });

const md = readFileSync(mdPath, "utf8");
const bodyHtml = marked.parse(md);
const generated = new Date().toISOString().slice(0, 10);
const css = readFileSync(cssPath, "utf8");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PVS ERP — Multi-machine &amp; parallel manufacturing</title>
  <style>${css}</style>
</head>
<body>
  <section class="cover-page">
    <div class="cover-top">
      <div class="logo-line">PVS · Kothavaripalle, AP</div>
      <h1>Multi-machine &amp;<br />parallel manufacturing</h1>
      <p class="subtitle">
        How MOs, work orders, production lines, and machines work together —
        including split operations for parallel extraction and filtering.
      </p>
    </div>
    <div class="cover-meta">
      <p><strong>Version</strong> 1.0</p>
      <p><strong>Generated</strong> ${generated}</p>
      <p><strong>Source</strong> docs/manufacturing-multi-machine-parallel.md</p>
    </div>
  </section>
  <article class="manual">${bodyHtml}</article>
</body>
</html>`;

writeFileSync(htmlPath, html, "utf8");
console.log("Wrote", htmlPath);

function findEdge() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const edge = findEdge();
if (!edge) {
  console.error(
    "Microsoft Edge not found. Open manufacturing-multi-machine-parallel.html and Print → Save as PDF."
  );
  process.exit(1);
}

const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/");
const result = spawnSync(
  edge,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    fileUrl,
  ],
  { stdio: "inherit", timeout: 120_000 }
);

if (result.error || result.status !== 0 || !existsSync(pdfPath)) {
  console.error("PDF generation failed. Open the HTML file and print manually.");
  process.exit(1);
}

writeFileSync(rootPdf, readFileSync(pdfPath));
const kb = Math.round(readFileSync(pdfPath).length / 1024);
console.log(`PDF: ${pdfPath} (${kb} KB)`);
console.log(`Copy: ${rootPdf}`);
