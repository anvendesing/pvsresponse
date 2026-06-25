#!/usr/bin/env node
/**
 * Build erp-user-manual.pdf from erp-user-manual.md
 *
 *   cd docs && npm install && npm run pdf
 *
 * Requires Microsoft Edge (headless print), same as brochure/build-pdf.ps1
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync, spawnSync } from "child_process";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mdPath = join(__dirname, "erp-user-manual.md");
const cssPath = join(__dirname, "erp-user-manual-print.css");
const htmlPath = join(__dirname, "erp-user-manual.html");
const pdfPath = join(__dirname, "erp-user-manual.pdf");
const rootPdf = join(__dirname, "..", "PVS-ERP-User-Manual.pdf");

marked.setOptions({
  gfm: true,
  breaks: false,
});

const md = readFileSync(mdPath, "utf8");
const bodyHtml = marked.parse(md);

const generated = new Date().toISOString().slice(0, 10);
const css = readFileSync(cssPath, "utf8");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PVS ERP — User Manual &amp; Training Guide</title>
  <style>${css}</style>
</head>
<body>
  <section class="cover-page">
    <div class="cover-top">
      <div class="logo-line">PVS · Kothavaripalle, AP</div>
      <h1>ERP User Manual<br />&amp; Training Guide</h1>
      <p class="subtitle">
        Desktop portal, mobile warehouse app, procurement, manufacturing,
        inventory, sales, and administration — for supervisors, warehouse,
        procurement, billing, and admin users.
      </p>
    </div>
    <div class="cover-meta">
      <p><strong>Version</strong> 1.0</p>
      <p><strong>Generated</strong> ${generated}</p>
      <p><strong>Source</strong> docs/erp-user-manual.md</p>
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
    "Microsoft Edge not found. Open erp-user-manual.html in a browser and Print → Save as PDF."
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
  console.error("PDF generation failed. Try opening erp-user-manual.html and printing manually.");
  process.exit(1);
}

writeFileSync(rootPdf, readFileSync(pdfPath));
const kb = Math.round(readFileSync(pdfPath).length / 1024);
console.log(`PDF: ${pdfPath} (${kb} KB)`);
console.log(`Copy: ${rootPdf}`);
