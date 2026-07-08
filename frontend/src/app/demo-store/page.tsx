import { notFound } from "next/navigation";
import { ApiError, publicApi } from "@/lib/api";
import MicrositeClient from "@/components/microsite/MicrositeClient";

// Live data — opt out of full-route caching so the server fetch runs per request.
export const dynamic = "force-dynamic";

// Stable alias for the demo/example store: www.tejotime.com/demo-store. Resolved by the fixed
// 'demo-store' slug (seeded via backend `npm run seed:demo`), so no env config is needed. A
// static segment takes precedence over the dynamic [phone] route.
export default async function DemoStorePage() {
  let initialSite;
  try {
    initialSite = await publicApi.getMicrosite("demo-store");
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound(); // demo store not seeded yet
    const message = e instanceof Error ? e.message : "Failed to load";
    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 32, textAlign: "center" }}>
        <span style={{ font: "var(--fw-bold) 20px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>Could not load this salon</span>
        <span style={{ font: "var(--fw-regular) 14px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{message}. Is the API running?</span>
      </div>
    );
  }

  return <MicrositeClient initialSite={initialSite} />;
}
