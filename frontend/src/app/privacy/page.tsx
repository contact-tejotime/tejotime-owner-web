import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/landing/Logo";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: t.privacy.metaTitle,
  description: t.privacy.metaDescription,
};

/**
 * Public privacy policy — Play Console and the landing footer need a stable URL
 * (`/privacy`) that is not a phone-keyed microsite. Copy lives in i18n so legal
 * edits do not require a layout rewrite.
 */
export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header
        style={{
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "18px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <Link href="/" aria-label={t.privacy.home}>
            <Logo height={40} />
          </Link>
          <Link
            href="/"
            style={{
              font: "var(--fw-semibold) 14px/1 var(--font-sans)",
              color: "var(--primary)",
              textDecoration: "none",
            }}
          >
            {t.privacy.home}
          </Link>
        </div>
      </header>

      <article style={{ maxWidth: 720, margin: "0 auto", padding: "48px 28px 80px" }}>
        <h1
          style={{
            font: "var(--fw-extrabold) 32px/1.15 var(--font-sans)",
            letterSpacing: "-.03em",
            color: "var(--text-strong)",
            margin: "0 0 10px",
          }}
        >
          {t.privacy.title}
        </h1>
        <p
          style={{
            font: "var(--fw-regular) 14px/1.5 var(--font-sans)",
            color: "var(--text-muted)",
            margin: "0 0 36px",
          }}
        >
          {t.privacy.lastUpdated}
        </p>

        {t.privacy.sections.map((section) => (
          <section key={section.heading} style={{ marginBottom: 28 }}>
            <h2
              style={{
                font: "var(--fw-bold) 18px/1.3 var(--font-sans)",
                color: "var(--text-strong)",
                margin: "0 0 10px",
              }}
            >
              {section.heading}
            </h2>
            {section.paragraphs.map((p) => (
              <p
                key={p.slice(0, 48)}
                style={{
                  font: "var(--fw-regular) 15px/1.65 var(--font-sans)",
                  color: "var(--text-body)",
                  margin: "0 0 10px",
                }}
              >
                {p}
              </p>
            ))}
          </section>
        ))}

        <p style={{ margin: "32px 0 0", font: "var(--fw-regular) 15px/1.65 var(--font-sans)" }}>
          <a href={`mailto:${t.privacy.contactEmail}`} style={{ color: "var(--primary)" }}>
            {t.privacy.contactEmail}
          </a>
        </p>
      </article>
    </div>
  );
}
