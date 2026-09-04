import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarketingChrome } from "@/components/landing/MarketingChrome";
import { shell } from "@/components/landing/shell";
import { Button } from "@/components/landing/ui";
import {
  getIndustryPage,
  INDUSTRY_SLUGS,
  industryPages,
  type IndustrySlug,
} from "@/components/landing/landingData";
import { Icon } from "@/components/landing/Icon";
import { t } from "@/i18n";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return INDUSTRY_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getIndustryPage(slug);
  if (!page) return { title: "TejoTime" };
  return {
    title: `${page.name} ${t.landing.industryPage.metaTitleSuffix}`,
    description: page.body,
  };
}

export default async function IndustryPage({ params }: Props) {
  const { slug } = await params;
  if (!(INDUSTRY_SLUGS as readonly string[]).includes(slug)) notFound();
  const page = getIndustryPage(slug as IndustrySlug);
  if (!page) notFound();

  const others = industryPages.filter((p) => p.slug !== page.slug);

  return (
    <MarketingChrome>
      <section style={{ padding: "56px 0 0", background: "var(--surface-card)" }}>
        <div data-t="pad" style={shell()}>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              font: "var(--fw-medium) 14px/1 var(--font-sans)",
              color: "var(--text-muted)",
              marginBottom: 28,
            }}
          >
            <Icon name="arrowRight" size={14} style={{ transform: "rotate(180deg)" }} />
            {t.landing.industryPage.backHome}
          </Link>

          <div
            className="tj-industry-hero"
            style={{
              display: "grid",
              gridTemplateColumns: "1.05fr 0.95fr",
              gap: 40,
              alignItems: "center",
              paddingBottom: 56,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <span
                style={{
                  font: "var(--fw-bold) 11px/1 var(--font-sans)",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--primary)",
                }}
              >
                {page.eyebrow}
              </span>
              <h1
                style={{
                  font: "var(--fw-extrabold) clamp(30px,4cqw,48px)/1.1 var(--font-sans)",
                  letterSpacing: "-.035em",
                  color: "var(--text-strong)",
                  margin: "14px 0 0",
                  maxWidth: "18ch",
                }}
              >
                {page.title}
              </h1>
              <p
                style={{
                  font: "var(--fw-regular) 17px/1.65 var(--font-sans)",
                  color: "var(--text-muted)",
                  margin: "18px 0 0",
                  maxWidth: "48ch",
                }}
              >
                {page.body}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28 }}>
                <Link href="/?join=1" style={{ display: "flex" }}>
                  <Button variant="primary" size="lg" trailingIcon="arrowRight">
                    {t.landing.cta.selfServe}
                  </Button>
                </Link>
                <Link href="/?join=1" style={{ display: "flex" }}>
                  <Button variant="outline" size="lg">
                    {t.landing.cta.bookDemo}
                  </Button>
                </Link>
              </div>
            </div>

            <div
              style={{
                borderRadius: "var(--radius-xl)",
                overflow: "hidden",
                border: "1px solid var(--border-subtle)",
                aspectRatio: "5 / 4",
                background: "var(--blue-50)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.image}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </div>
          </div>
        </div>
      </section>

      <section
        data-t="sect"
        style={{ padding: "72px 0", background: "var(--surface-page)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div data-t="pad" style={shell()}>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              maxWidth: "60ch",
            }}
          >
            {page.bullets.map((b) => (
              <li
                key={b}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  font: "var(--fw-medium) 16px/1.5 var(--font-sans)",
                  color: "var(--text-body)",
                }}
              >
                <span style={{ color: "var(--primary)", flexShrink: 0, paddingTop: 2, display: "flex" }}>
                  <Icon name="check" size={17} />
                </span>
                {b}
              </li>
            ))}
          </ul>

          <div
            style={{
              marginTop: 48,
              paddingTop: 40,
              borderTop: "1px solid var(--border-subtle)",
              maxWidth: "56ch",
            }}
          >
            <h2
              style={{
                font: "var(--fw-extrabold) clamp(24px,3cqw,32px)/1.15 var(--font-sans)",
                letterSpacing: "-.03em",
                color: "var(--text-strong)",
                margin: 0,
              }}
            >
              {t.landing.industryPage.whyTitle}
            </h2>
            <p
              style={{
                font: "var(--fw-regular) 16.5px/1.65 var(--font-sans)",
                color: "var(--text-muted)",
                margin: "14px 0 0",
              }}
            >
              {t.landing.industryPage.whyBody}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28 }}>
              <Link href="/?join=1" style={{ display: "flex" }}>
                <Button variant="primary" trailingIcon="arrowRight">
                  {t.landing.cta.selfServe}
                </Button>
              </Link>
              <Link href="/?join=1" style={{ display: "flex" }}>
                <Button variant="outline">{t.landing.cta.bookDemo}</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section
        data-t="sect"
        style={{ padding: "64px 0 80px", background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}
      >
        <div data-t="pad" style={shell()}>
          <h2
            style={{
              font: "var(--fw-extrabold) clamp(22px,2.8cqw,28px)/1.2 var(--font-sans)",
              letterSpacing: "-.025em",
              color: "var(--text-strong)",
              margin: "0 0 24px",
            }}
          >
            {t.landing.industryPage.otherTitle}
          </h2>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px 18px",
            }}
          >
            {others.map((p) => (
              <Link
                key={p.slug}
                href={p.href}
                className="tj-footlink"
                style={{
                  font: "var(--fw-medium) 14.5px/1.4 var(--font-sans)",
                  color: "var(--text-body)",
                }}
              >
                {p.name}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </MarketingChrome>
  );
}
