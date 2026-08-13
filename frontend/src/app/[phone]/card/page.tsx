import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ApiError, publicApi } from "@/lib/api";
import { API_BASE_URL } from "@/lib/config";
import { t, format } from "@/i18n";
import { micrositeThemeConfig } from "@/theme";
import ThemeStyle from "@/theme/ThemeStyle";

/**
 * QR landing page — `/<phone>/card`.
 *
 * What a printed or on-screen QR points at. Scanning it used to drop straight into the OS
 * Add-Contact card, which assumed the only reason anyone scans a shop's code is to save its
 * number. Most people are scanning to book. So the code now lands here and asks: book, or save
 * the contact? Saving still hands off to exactly the same `.vcf` endpoint as before.
 *
 * Deliberately server-rendered with no client JS: it is the first thing a customer sees after
 * pointing a camera at a sticker, often on a bad connection, and both actions are plain links.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ phone: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { phone } = await params;
  if (!/^\d{7,15}$/.test(phone)) return {};
  try {
    const site = await publicApi.getMicrositeByPhone(phone);
    return {
      title: format(t.microsite.card.metaTitle, { name: site.name }),
      description: format(t.microsite.card.metaDescription, { name: site.name }),
    };
  } catch {
    return {};
  }
}

export default async function CardPage({ params }: Props) {
  const { phone } = await params;
  // Same guard as the microsite route: only digit strings are phone URLs.
  if (!/^\d{7,15}$/.test(phone)) notFound();

  let site;
  try {
    site = await publicApi.getMicrositeByPhone(phone);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const themeConfig = micrositeThemeConfig(site);
  // `?open=1` makes the backend serve the card inline, so the phone shows the Add-Contact
  // sheet instead of downloading a file. Unchanged from the previous behaviour.
  const vcardUrl = `${API_BASE_URL}/public/businesses/${site.slug}/vcard?open=1`;

  return (
    <>
      <ThemeStyle config={themeConfig} />
      <div
        data-tt-theme={themeConfig.preset}
        data-tt-mode={themeConfig.mode}
        style={{
          minHeight: "100dvh",
          background: "var(--surface-page)",
          color: "var(--text-body)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "clamp(20px, 6vw, 48px)",
        }}
      >
        <div
          style={{
            width: 420,
            maxWidth: "100%",
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "calc(22px * var(--radius-scale, 1))",
            boxShadow: "var(--shadow-lg)",
            padding: "clamp(24px, 6vw, 36px)",
            textAlign: "center",
          }}
        >
          {site.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={site.logoUrl}
              alt={site.name}
              style={{
                width: 76,
                height: 76,
                objectFit: "contain",
                borderRadius: "calc(18px * var(--radius-scale, 1))",
                margin: "0 auto 18px",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                width: 76,
                height: 76,
                margin: "0 auto 18px",
                borderRadius: "calc(18px * var(--radius-scale, 1))",
                background: "linear-gradient(135deg, var(--brand-ink), var(--primary))",
                color: "var(--text-on-brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: "var(--fw-extrabold) 30px/1 var(--font-sans)",
              }}
            >
              {site.name.charAt(0)}
            </div>
          )}

          <h1
            style={{
              font: "var(--fw-extrabold) clamp(22px, 5vw, 28px)/1.2 var(--font-display, var(--font-sans))",
              letterSpacing: "-.02em",
              color: "var(--text-strong)",
              margin: "0 0 6px",
            }}
          >
            {site.name}
          </h1>
          <p
            style={{
              font: "var(--fw-medium) 14px/1.5 var(--font-sans)",
              color: "var(--text-muted)",
              margin: "0 0 26px",
            }}
          >
            {[site.category, site.area].filter(Boolean).join(" · ")}
          </p>

          <a
            href={`/${phone}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "var(--control-h-lg, 52px)",
              borderRadius: "calc(12px * var(--radius-scale, 1))",
              background: "var(--primary)",
              color: "var(--text-on-brand)",
              border: "1px solid var(--brand-outline, transparent)",
              font: "var(--fw-bold) 16px/1 var(--font-sans)",
              textDecoration: "none",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            {t.microsite.card.bookAppointment}
          </a>

          <a
            href={vcardUrl}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "var(--control-h-lg, 52px)",
              marginTop: 12,
              borderRadius: "calc(12px * var(--radius-scale, 1))",
              background: "var(--surface-card)",
              color: "var(--text-strong)",
              border: "1px solid var(--border-default)",
              font: "var(--fw-semibold) 16px/1 var(--font-sans)",
              textDecoration: "none",
            }}
          >
            {t.microsite.card.saveContact}
          </a>

          <p
            style={{
              font: "var(--fw-regular) 12px/1.5 var(--font-sans)",
              color: "var(--text-subtle)",
              margin: "20px 0 0",
            }}
          >
            {format(t.microsite.card.savingNote, { name: site.name })}
          </p>
        </div>
      </div>
    </>
  );
}
