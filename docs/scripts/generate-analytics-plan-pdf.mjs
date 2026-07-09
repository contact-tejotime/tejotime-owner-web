/**
 * Generates docs/admin-analytics-plan.pdf from docs/admin-analytics-plan.html
 * Uses Chrome headless (no extra npm dependencies).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, "..");
const htmlPath = path.join(docsDir, "admin-analytics-plan.html");
const pdfPath = path.join(docsDir, "admin-analytics-plan.pdf");

const chromePaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const browser = chromePaths.find((p) => fs.existsSync(p));
if (!browser) {
  console.error("Chrome or Edge not found. Install Chrome to generate PDF.");
  process.exit(1);
}

if (!fs.existsSync(htmlPath)) {
  console.error(`HTML not found: ${htmlPath}`);
  process.exit(1);
}

const fileUrl = `file:///${htmlPath.replace(/\\/g, "/")}`;

const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-pdf-header-footer",
  `--print-to-pdf=${pdfPath}`,
  fileUrl,
];

console.log(`Using browser: ${browser}`);
console.log(`Input:  ${htmlPath}`);
console.log(`Output: ${pdfPath}`);

const proc = spawn(browser, args, { stdio: "inherit" });

proc.on("close", (code) => {
  if (code !== 0) {
    console.error(`Browser exited with code ${code}`);
    process.exit(code ?? 1);
  }
  if (!fs.existsSync(pdfPath)) {
    console.error("PDF was not created.");
    process.exit(1);
  }
  const sizeKb = Math.round(fs.statSync(pdfPath).size / 1024);
  console.log(`Done — ${pdfPath} (${sizeKb} KB)`);
});
