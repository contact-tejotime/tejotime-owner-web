/**
 * Neutralize CSV formula/DDE injection. A cell whose first character is one of
 * = + - @ (or a leading tab/CR) is treated as a formula by Excel/Sheets and can
 * exfiltrate data or run commands when the file is opened. Since these exports
 * carry attacker-influenceable data (customer names, notes, store names), prefix
 * such cells with a single quote so they render as literal text.
 */
function sanitizeCell(value: unknown): string {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Build a CSV from string rows and trigger a browser download. Client-side only. */
export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) => r.map((v) => `"${sanitizeCell(v).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  // Prepend a UTF-8 BOM so Excel on Windows renders ₹ and non-ASCII names correctly.
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
