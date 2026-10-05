import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { publicApi } from "@/lib/api";
import { t } from "@/i18n";
import { micrositeThemeConfig, type ThemeConfig } from "@/theme";
import ThemeStyle from "@/theme/ThemeStyle";
import SeriesManage from "@/components/microsite/SeriesManage";

/**
 * Repeating-booking manage page — `/<store phone>/v#<manage token>`
 * (docs/recurring-appointments.md §1.3, §5). The success screen and the confirmation SMS link here.
 *
 * The token is in the fragment, which never reaches this server, so everything about the series is
 * read on the client (SeriesManage). The server's only jobs are the phone guard, the noindex, and
 * dressing the page in the store's theme like `/<phone>/card` does.
 */

export const dynamic = "force-dynamic";

// A personal page behind a secret link: never indexed, never followed, whatever the store.
export const metadata: Metadata = {
  title: t.microsite.series.metaTitle,
  description: t.microsite.series.metaDescription,
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ phone: string }> };

export default async function SeriesManagePage({ params }: Props) {
  const { phone } = await params;
  // Same guard as the microsite and /card routes: only digit strings are phone URLs.
  if (!/^\d{7,15}$/.test(phone)) notFound();

  // Best-effort: a failed lookup costs only the store's colours (the page falls back to the
  // default tokens) — never the page, since the series is fetched by token, not by this phone.
  let themeConfig: ThemeConfig | null = null;
  // The same lookup also tells the time picker which weekdays to grey out. Only when hours are set:
  // a store with none reports every day closed, and greying every day would leave nothing to pick.
  let storeHours: { slug: string; closedWeekdays: number[] } | null = null;
  try {
    const site = await publicApi.getMicrositeByPhone(phone);
    themeConfig = micrositeThemeConfig(site);
    storeHours = {
      slug: site.slug,
      closedWeekdays: site.hours.length > 0 ? site.hours.filter((h) => h.isClosed).map((h) => h.dayOfWeek) : [],
    };
  } catch {
    themeConfig = null;
  }

  return (
    <>
      {themeConfig ? <ThemeStyle config={themeConfig} /> : null}
      <div
        data-tt-theme={themeConfig?.preset}
        data-tt-mode={themeConfig?.mode}
        style={{
          minHeight: "100dvh",
          background: "var(--surface-page)",
          color: "var(--text-body)",
          padding: "clamp(16px, 6vw, 48px) 16px",
        }}
      >
        <SeriesManage phone={phone} storeHours={storeHours} />
      </div>
    </>
  );
}
