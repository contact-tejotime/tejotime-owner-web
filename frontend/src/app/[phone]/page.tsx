import { notFound } from "next/navigation";
import { ApiError, publicApi } from "@/lib/api";
import MicrositeClient from "@/components/microsite/MicrositeClient";

// Live data — opt out of full-route caching so the server fetch runs per request
// (this also makes the underlying fetch `no-store`). Matches the previous /sharp-cuts page.
export const dynamic = "force-dynamic";

// Phone-keyed microsite: www.tejotime.com/<phone> where <phone> is the business's full
// international number (country code + national number, digits only, no '+'). Resolving the
// business returns its slug, which the client uses for every follow-on queue/booking call.
export default async function PhonePage({ params }: { params: Promise<{ phone: string }> }) {
  const { phone } = await params;

  // Only digit strings are phone URLs. Anything else isn't a microsite → 404
  // (a root dynamic segment otherwise matches every single-segment path).
  if (!/^\d{7,15}$/.test(phone)) notFound();

  let initialSite;
  try {
    initialSite = await publicApi.getMicrositeByPhone(phone);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound(); // no business with this number
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
