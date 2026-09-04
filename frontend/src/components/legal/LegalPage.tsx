import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Logo } from "@/components/landing/Logo";
import { t } from "@/i18n";

/**
 * Shared shell for the three public legal documents (/privacy, /terms,
 * /accessibility). Copy lives in i18n so a legal edit never touches layout.
 *
 * Company-specific facts — legal entity, mailing address, governing state,
 * support phone — are written into the copy as `{token}` placeholders and
 * resolved here from `t.legal`. A token whose value is still blank renders as a
 * visible amber marker instead of silently disappearing, so an unverified
 * detail cannot ship unnoticed. Fill the value in `t.legal` and the marker
 * becomes ordinary text everywhere it appears.
 */

const WRAP = 760;

export type LegalSection = {
  heading: string;
  paragraphs: readonly string[];
  bullets: readonly string[];
};

export type LegalDoc = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: readonly LegalSection[];
};

/* --------------------------------------------------------- token filling -- */

type FieldKey = "entity" | "address" | "state" | "email" | "phone" | "website";

/** Value + human label for each `{token}` the legal copy may reference. */
const FIELDS: Record<FieldKey, { value: string; label: string }> = {
  entity: { value: t.legal.entity, label: t.legal.fields.entity },
  address: { value: t.legal.address, label: t.legal.fields.address },
  state: { value: t.legal.governingState, label: t.legal.fields.state },
  phone: { value: t.legal.supportPhone, label: t.legal.fields.phone },
  email: { value: t.legal.supportEmail, label: "email" },
  website: { value: t.legal.website, label: "website" },
};

const pendingStyle: CSSProperties = {
  background: "var(--warning-soft)",
  color: "var(--warning-soft-fg)",
  border: "1px dashed var(--warning)",
  borderRadius: 4,
  padding: "0 6px",
  font: "var(--fw-semibold) 13.5px/1.4 var(--font-sans)",
  // Must wrap: at 320px the unbroken chip pushed the whole page 56px wide.
  whiteSpace: "normal",
};

/**
 * Split copy on `{token}` and swap in the resolved value. Unfilled tokens
 * become an amber "— to be confirmed" chip rather than an empty gap.
 */
function fill(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\{[a-z]+\})/g).map((part, i) => {
    const match = /^\{([a-z]+)\}$/.exec(part);
    const field = match ? FIELDS[match[1] as FieldKey] : undefined;
    if (!field) return <span key={`${keyPrefix}-${i}`}>{part}</span>;
    if (field.value) return <span key={`${keyPrefix}-${i}`}>{field.value}</span>;
    return (
      <mark key={`${keyPrefix}-${i}`} style={pendingStyle}>
        [{field.label} — {t.legal.pendingSuffix}]
      </mark>
    );
  });
}

/* ---------------------------------------------------------------- pieces -- */

/** Stable, readable fragment id for a heading like "3. Security" → "3-security". */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function Header({ current }: { current: string }) {
  return (
    <header style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}>
      <div
        style={{
          maxWidth: WRAP,
          margin: "0 auto",
          padding: "18px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <Link href="/" aria-label={t.brand.logoAlt}>
          <Logo height={36} />
        </Link>
        <Link
          href="/"
          style={{ font: "var(--fw-semibold) 14px/1 var(--font-sans)", color: "var(--primary)" }}
        >
          {t.legal.home}
        </Link>
      </div>
      <nav
        aria-label={t.legal.eyebrow}
        style={{
          maxWidth: WRAP,
          margin: "0 auto",
          padding: "0 28px 14px",
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
        }}
      >
        {t.legal.docNav.map((d) => {
          const on = d.href === current;
          return (
            <Link
              key={d.href}
              href={d.href}
              aria-current={on ? "page" : undefined}
              style={{
                font: `var(${on ? "--fw-semibold" : "--fw-medium"}) 13.5px/1 var(--font-sans)`,
                color: on ? "var(--text-strong)" : "var(--text-muted)",
                borderBottom: on ? "2px solid var(--primary)" : "2px solid transparent",
                paddingBottom: 4,
              }}
            >
              {d.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function Contact() {
  const rows: { label: string; value: string; href?: string }[] = [
    { label: t.legal.emailLabel, value: t.legal.supportEmail, href: `mailto:${t.legal.supportEmail}` },
  ];
  // Phone and postal address appear only once real, verified values exist.
  if (t.legal.supportPhone) {
    rows.push({
      label: t.legal.phoneLabel,
      value: t.legal.supportPhone,
      href: `tel:${t.legal.supportPhone.replace(/[^+\d]/g, "")}`,
    });
  }
  if (t.legal.address) rows.push({ label: t.legal.addressLabel, value: t.legal.address });

  return (
    <section
      style={{
        marginTop: 40,
        padding: "22px 24px",
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <h2
        style={{
          font: "var(--fw-bold) 17px/1.3 var(--font-sans)",
          color: "var(--text-strong)",
          margin: "0 0 12px",
        }}
      >
        {t.legal.contactHeading}
      </h2>
      <dl style={{ margin: 0, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <dt style={{ font: "var(--fw-semibold) 14px/1.5 var(--font-sans)", color: "var(--text-muted)", minWidth: 76 }}>
            {t.legal.fields.entity.replace(/^\w/, (c) => c.toUpperCase())}
          </dt>
          <dd style={{ margin: 0, font: "var(--fw-medium) 14px/1.5 var(--font-sans)", color: "var(--text-body)" }}>
            {fill("{entity}", "contact-entity")}
          </dd>
        </div>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <dt style={{ font: "var(--fw-semibold) 14px/1.5 var(--font-sans)", color: "var(--text-muted)", minWidth: 76 }}>
              {r.label}
            </dt>
            <dd style={{ margin: 0, font: "var(--fw-medium) 14px/1.5 var(--font-sans)", color: "var(--text-body)" }}>
              {r.href ? (
                <a href={r.href} style={{ color: "var(--primary)" }}>
                  {r.value}
                </a>
              ) : (
                r.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ page -- */

export function LegalPage({ doc, current }: { doc: LegalDoc; current: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <Header current={current} />

      <article style={{ maxWidth: WRAP, margin: "0 auto", padding: "44px 28px 88px" }}>
        <p
          style={{
            font: "var(--fw-bold) 11px/1 var(--font-sans)",
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            margin: "0 0 12px",
          }}
        >
          {t.legal.eyebrow}
        </p>
        <h1
          style={{
            font: "var(--fw-extrabold) clamp(28px,4vw,36px)/1.15 var(--font-sans)",
            letterSpacing: "-.03em",
            color: "var(--text-strong)",
            margin: "0 0 10px",
          }}
        >
          {doc.title}
        </h1>
        <p
          style={{
            font: "var(--fw-regular) 14px/1.5 var(--font-sans)",
            color: "var(--text-muted)",
            margin: "0 0 24px",
          }}
        >
          {doc.lastUpdated}
        </p>
        <p
          style={{
            font: "var(--fw-regular) 16px/1.7 var(--font-sans)",
            color: "var(--text-body)",
            margin: "0 0 36px",
            textWrap: "pretty",
          }}
        >
          {fill(doc.intro, "intro")}
        </p>

        <nav
          aria-label={t.legal.onThisPage}
          style={{
            margin: "0 0 40px",
            padding: "18px 22px",
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          <p
            style={{
              font: "var(--fw-bold) 11px/1 var(--font-sans)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              margin: "0 0 12px",
            }}
          >
            {t.legal.onThisPage}
          </p>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 7 }}>
            {doc.sections.map((s) => (
              <li key={s.heading}>
                <a
                  href={`#${slug(s.heading)}`}
                  style={{ font: "var(--fw-medium) 14px/1.4 var(--font-sans)", color: "var(--primary)" }}
                >
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {doc.sections.map((section) => (
          <section key={section.heading} id={slug(section.heading)} style={{ marginBottom: 32, scrollMarginTop: 24 }}>
            <h2
              style={{
                font: "var(--fw-bold) 19px/1.3 var(--font-sans)",
                color: "var(--text-strong)",
                margin: "0 0 12px",
              }}
            >
              {section.heading}
            </h2>
            {section.paragraphs.map((p, i) => (
              <p
                key={p.slice(0, 48)}
                style={{
                  font: "var(--fw-regular) 15.5px/1.7 var(--font-sans)",
                  color: "var(--text-body)",
                  margin: "0 0 12px",
                  textWrap: "pretty",
                }}
              >
                {fill(p, `${slug(section.heading)}-p${i}`)}
              </p>
            ))}
            {section.bullets.length > 0 && (
              <ul style={{ margin: "0 0 12px", paddingLeft: 22, display: "grid", gap: 8 }}>
                {section.bullets.map((b, i) => (
                  <li
                    key={b.slice(0, 48)}
                    style={{
                      font: "var(--fw-regular) 15.5px/1.7 var(--font-sans)",
                      color: "var(--text-body)",
                      textWrap: "pretty",
                    }}
                  >
                    {fill(b, `${slug(section.heading)}-b${i}`)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <Contact />
      </article>
    </div>
  );
}
