import { publicApi } from "@/lib/api";
import SharpCutsClient from "./SharpCutsClient";

const SLUG = "sharp-cuts";

// Live data — opt out of full-route caching so the server fetch runs per request
// (this also makes the underlying fetch `no-store`).
export const dynamic = "force-dynamic";

export default async function SharpCutsPage() {
  let initialSite;
  try {
    initialSite = await publicApi.getMicrosite(SLUG);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load";
    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 32, textAlign: "center" }}>
        <span style={{ font: "var(--fw-bold) 20px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>Could not load this salon</span>
        <span style={{ font: "var(--fw-regular) 14px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{message}. Is the API running?</span>
      </div>
    );
  }

  return <SharpCutsClient initialSite={initialSite} />;
}
