import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError, publicApi } from "@/lib/api";
import MicrositeClient from "@/components/microsite/MicrositeClient";
import ThemeStyle from "@/theme/ThemeStyle";
import { micrositeThemeConfig } from "@/theme";
import { t, format } from "@/i18n";

// Live data — opt out of full-route caching so the server fetch runs per request
// (this also makes the underlying fetch `no-store`). Matches the previous /sharp-cuts page.
export const dynamic = "force-dynamic";

/**
 * Per-store title. Without this the page inherited the root layout's marketing title, so every
 * customer booking page in every browser tab, share card and search result was called "TejoTime |
 * Online Booking and Scheduling for Service Businesses" — the platform's name, not the shop's.
 *
 * A failed lookup falls through to the layout default rather than throwing: metadata must never
 * be the reason the page 500s, and the page body handles the same failure on its own.
 */
export async function generateMetadata({ params }: { params: Promise<{ phone: string }> }): Promise<Metadata> {
  const { phone } = await params;
  if (!/^\d{7,15}$/.test(phone)) return {};
  try {
    const site = await publicApi.getMicrositeByPhone(phone);
    return {
      title: format(t.microsite.meta.title, { name: site.name }),
      description: format(t.microsite.meta.description, { name: site.name }),
    };
  } catch {
    return {};
  }
}

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
    const message = e instanceof Error ? e.message : t.errorPage.failedToLoad;
    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 32, textAlign: "center" }}>
        <span style={{ font: "var(--fw-bold) 20px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>{t.errorPage.title}</span>
        <span style={{ font: "var(--fw-regular) 14px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{format(t.errorPage.apiHint, { message })}</span>
      </div>
    );
  }

  // Theme tokens are emitted server-side, above the microsite, so the very first paint is
  // already in the store's brand — no client JS on this path and therefore no flash of blue.
  return (
    <>
      {/*
        The hero is painted as a CSS background-image, which the preload scanner cannot see: the
        browser would have to download and parse CSS, then lay the element out, before it even
        learns the URL. It is also the LCP element on this page. Preloading it here starts the
        fetch in the same breath as the document, without touching any markup or layout.
      */}
      {initialSite.heroImageUrl ? (
        <link rel="preload" as="image" href={initialSite.heroImageUrl} fetchPriority="high" />
      ) : null}
      <ThemeStyle config={micrositeThemeConfig(initialSite)} />
      <MicrositeClient initialSite={initialSite} />
    </>
  );
}
