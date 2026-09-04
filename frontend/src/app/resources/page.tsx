import type { Metadata } from "next";
import Link from "next/link";

import { MarketingChrome } from "@/components/landing/MarketingChrome";
import { shell } from "@/components/landing/shell";
import { Button } from "@/components/landing/ui";
import { faqs } from "@/components/landing/landingData";
import { Icon } from "@/components/landing/Icon";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: t.landing.resources.metaTitle,
  description: t.landing.resources.metaDescription,
};

export default function ResourcesPage() {
  return (
    <MarketingChrome>
      <section style={{ padding: "64px 0 40px", background: "var(--surface-card)" }}>
        <div data-t="pad" style={shell({ textAlign: "center" })}>
          <h1
            style={{
              font: "var(--fw-extrabold) clamp(32px,4.2cqw,48px)/1.1 var(--font-sans)",
              letterSpacing: "-.035em",
              color: "var(--text-strong)",
              margin: 0,
            }}
          >
            {t.landing.resources.title}
          </h1>
          <p
            style={{
              font: "var(--fw-regular) 17px/1.65 var(--font-sans)",
              color: "var(--text-muted)",
              margin: "16px auto 0",
              maxWidth: "48ch",
            }}
          >
            {t.landing.resources.body}
          </p>
        </div>
      </section>

      <section
        data-t="sect"
        style={{ padding: "48px 0 72px", background: "var(--surface-page)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div
          data-t="pad"
          style={{
            ...shell(),
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 24,
          }}
          className="tj-resources-grid"
        >
          <div
            style={{
              padding: "28px 24px",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-card)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minWidth: 0,
            }}
          >
            <h2
              style={{
                font: "var(--fw-bold) 20px/1.25 var(--font-sans)",
                color: "var(--text-strong)",
                margin: 0,
              }}
            >
              {t.landing.resources.howTitle}
            </h2>
            <p
              style={{
                font: "var(--fw-regular) 15px/1.6 var(--font-sans)",
                color: "var(--text-muted)",
                margin: 0,
                flex: 1,
              }}
            >
              {t.landing.resources.howBody}
            </p>
            <Link href="/#tour" style={{ display: "flex", marginTop: 8 }}>
              <Button variant="primary" fullWidth trailingIcon="arrowRight">
                {t.landing.resources.howCta}
              </Button>
            </Link>
          </div>

          <div
            style={{
              padding: "28px 24px",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-card)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minWidth: 0,
            }}
          >
            <h2
              style={{
                font: "var(--fw-bold) 20px/1.25 var(--font-sans)",
                color: "var(--text-strong)",
                margin: 0,
              }}
            >
              {t.landing.resources.faqTitle}
            </h2>
            <p
              style={{
                font: "var(--fw-regular) 15px/1.6 var(--font-sans)",
                color: "var(--text-muted)",
                margin: 0,
                flex: 1,
              }}
            >
              {t.landing.resources.faqBody}
            </p>
            <Link href="/#faq" style={{ display: "flex", marginTop: 8 }}>
              <Button variant="outline" fullWidth>
                {t.landing.resources.faqCta}
              </Button>
            </Link>
          </div>

          <div
            style={{
              padding: "28px 24px",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-card)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minWidth: 0,
            }}
          >
            <h2
              style={{
                font: "var(--fw-bold) 20px/1.25 var(--font-sans)",
                color: "var(--text-strong)",
                margin: 0,
              }}
            >
              {t.landing.resources.supportTitle}
            </h2>
            <p
              style={{
                font: "var(--fw-regular) 15px/1.6 var(--font-sans)",
                color: "var(--text-muted)",
                margin: 0,
                flex: 1,
              }}
            >
              {t.landing.resources.supportBody}
            </p>
            <a
              href={`mailto:${t.landing.resources.supportEmail}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
                font: "var(--fw-semibold) 15px/1.4 var(--font-sans)",
                color: "var(--primary)",
              }}
            >
              <Icon name="bell" size={16} />
              {t.landing.resources.supportEmail}
            </a>
            <a
              href={`tel:${t.landing.resources.supportPhone.replace(/[^+\d]/g, "")}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginTop: 4,
                font: "var(--fw-semibold) 15px/1.4 var(--font-sans)",
                color: "var(--primary)",
              }}
            >
              <Icon name="phone" size={16} />
              {t.landing.resources.supportPhone}
            </a>
          </div>
        </div>

        <div data-t="pad" style={{ ...shell(), marginTop: 56, maxWidth: 720 }}>
          <h2
            style={{
              font: "var(--fw-extrabold) clamp(22px,2.8cqw,28px)/1.2 var(--font-sans)",
              letterSpacing: "-.025em",
              color: "var(--text-strong)",
              margin: "0 0 20px",
            }}
          >
            {t.landing.faq.title}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {faqs.map((q) => (
              <div
                key={q.q}
                style={{
                  padding: "20px 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <h3
                  style={{
                    font: "var(--fw-bold) 16px/1.35 var(--font-sans)",
                    color: "var(--text-strong)",
                    margin: 0,
                  }}
                >
                  {q.q}
                </h3>
                <p
                  style={{
                    font: "var(--fw-regular) 15px/1.65 var(--font-sans)",
                    color: "var(--text-muted)",
                    margin: "10px 0 0",
                  }}
                >
                  {q.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingChrome>
  );
}
