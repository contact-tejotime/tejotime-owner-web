import Link from "next/link";

// Shown for unknown/invalid phone URLs and any unmatched single-segment path
// (the [phone] route calls notFound() for non-numeric or unknown numbers).
export default function NotFound() {
  return (
    <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 32, textAlign: "center" }}>
      <span style={{ font: "var(--fw-bold) 22px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>We couldn&apos;t find that salon</span>
      <span style={{ font: "var(--fw-regular) 14px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>Check the number and try again.</span>
      <Link href="/" style={{ font: "var(--fw-semibold) 14px/1 var(--font-sans)", color: "var(--primary)" }}>Go home</Link>
    </div>
  );
}
