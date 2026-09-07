"use client";

import { t, format } from "@/i18n";

/**
 * Microsite sections — TejoTime Microsite v3.
 *
 * Ported from the Claude Design file `TejoTime Microsite v3.dc.html`. The design system's
 * tokens are byte-identical to globals.css (same --text-strong / --surface-page /
 * --border-subtle / --fw-* / --shadow-*), so this is a layout port, not a token migration.
 *
 * The design's two page-local variables map onto the theme engine, which is what makes the
 * whole thing theme per store instead of shipping the mock's maroon:
 *     --biz-accent  →  var(--primary)      (the store's brand colour)
 *     --biz-deep    →  var(--brand-900)    (dark end of its ramp, for the gradient cards)
 *     --tint        →  var(--surface-page)
 *     --line        →  var(--border-subtle)
 *
 * Nothing here owns behaviour: every handler is passed in from MicrositeClient, which still
 * runs the queue, booking, socket and modal logic untouched.
 */

import { useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Reveal } from "./motion";

/* ------------------------------------------------------------------ shared */

/** v3 container is wider than the old 1180. */
const MAX = 1320;

const EYEBROW: CSSProperties = {
  font: "var(--fw-bold) 11px/1 var(--font-sans)",
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: "var(--primary)",
};

const H2: CSSProperties = {
  font: "var(--fw-extrabold) clamp(26px, 4.4vw, 60px)/1.02 var(--font-sans)",
  letterSpacing: "-.04em",
  color: "var(--text-strong)",
  margin: "18px 0 0",
};

/**
 * Section shell.
 *
 * v3 alternates white and tinted bands, which is why its 96px padding reads as breathing room
 * inside a block rather than as dead space between blocks — the reason the old uniform-white
 * layout felt too airy at the same numbers.
 */
export function Section({
  id,
  children,
  tone = "page",
  style,
}: {
  id?: string;
  children: ReactNode;
  tone?: "page" | "tint";
  style?: CSSProperties;
}) {
  return (
    <div
      id={id}
      style={{ background: tone === "tint" ? "var(--surface-page)" : "var(--surface-card)" }}
    >
      <div
        style={{
          maxWidth: MAX,
          margin: "0 auto",
          padding:
            "calc(var(--section-y, clamp(30px, 6vw, 84px)) * var(--density-scale, 1)) clamp(18px, 4vw, 30px)",
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Eyebrow + display heading left, supporting note right — v3's section header rhythm. */
export function SectionHead({
  eyebrow,
  title,
  note,
  trailing,
}: {
  eyebrow: string;
  title: string;
  note?: string;
  trailing?: ReactNode;
}) {
  return (
    <Reveal>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={EYEBROW}>{eyebrow}</div>
          <h2 style={H2}>{title}</h2>
        </div>
        {trailing ??
          (note && (
            <span
              style={{
                font: "var(--fw-medium) 14px/1.5 var(--font-sans)",
                color: "var(--text-muted)",
                maxWidth: 300,
              }}
            >
              {note}
            </span>
          ))}
      </div>
    </Reveal>
  );
}

/* ----------------------------------------------------------------- ticker */

/**
 * Accent marquee between the hero and the live floor. Duplicated once and translated -50%, so
 * the loop is seamless. Pure decoration — hidden from assistive tech and stopped under
 * prefers-reduced-motion (see salon.css).
 */
export function Ticker({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div aria-hidden style={{ position: "relative", overflow: "hidden", background: "var(--primary)", padding: "16px 0" }}>
      <div className="ttMarquee" style={{ display: "flex", width: "max-content" }}>
        {[0, 1].map((run) => (
          <div key={run} style={{ display: "flex", alignItems: "center", gap: 44, flex: "0 0 auto", paddingRight: 44 }}>
            {items.map((tick, i) => (
              <span
                key={`${run}-${i}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 14,
                  whiteSpace: "nowrap",
                  font: "var(--fw-bold) 15px/1 var(--font-sans)",
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--text-on-brand)",
                  opacity: 0.94,
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,.5)" }} />
                {tick}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- live availability */

export interface LiveMember {
  id: string;
  name: string;
  role: string;
  photo: string | null;
  avBg: string;
  busy: boolean;
  count: number;
  wait: string;
}

/** v3's live floor: a dark brand-gradient summary tile followed by one card per member. */
export function LiveBoard({
  members,
  heading,
  queueWord,
  liveHeadline,
  liveSub,
  ctaLabel,
  onJoin,
  walkInsClosed = false,
}: {
  members: LiveMember[];
  heading: string;
  queueWord: string;
  liveHeadline: string;
  liveSub: ReactNode;
  ctaLabel: (name: string) => string;
  onJoin: (id: string) => void;
  /** Outside business hours the board stays visible — a customer still wants to see who works
   *  here — but nothing on it may read as "walk in now". The caller swaps `ctaLabel` to the
   *  booking wording; this flag handles the status chip and the live counters. */
  walkInsClosed?: boolean;
}) {
  return (
    <>
      <SectionHead
        eyebrow={t.microsite.sections.liveFloor}
        title={heading}
        note={format(t.microsite.sections.liveNote, { queueWord })}
      />

      <Reveal>
        <div className="ttLiveGrid" style={{ marginTop: "clamp(24px, 3.5vw, 44px)" }}>
          {/* Summary tile — the store's own brand, dark end of its ramp. */}
          <div
            style={{
              borderRadius: "calc(26px * var(--radius-scale, 1))",
              padding: "clamp(18px, 3vw, 34px)",
              background: "linear-gradient(150deg, var(--primary), var(--brand-900))",
              position: "relative",
              overflow: "hidden",
              minHeight: "clamp(150px, 26vw, 270px)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: -60,
                top: -60,
                // Scales with the tile: a fixed 230px orb swallowed the whole card once the
                // minimum height came down on a phone.
                width: "clamp(140px, 20vw, 230px)",
                height: "clamp(140px, 20vw, 230px)",
                borderRadius: "50%",
                background: "rgba(255,255,255,.09)",
              }}
            />
            <div
              style={{
                position: "relative",
                font: "var(--fw-bold) 11px/1 var(--font-sans)",
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,.62)",
              }}
            >
              {t.microsite.sections.waitRightNow}
            </div>
            <div
              style={{
                position: "relative",
                font: "var(--fw-extrabold) clamp(28px, 4.4vw, 56px)/0.98 var(--font-sans)",
                letterSpacing: "-.04em",
                color: "#fff",
                marginTop: "auto",
              }}
            >
              {liveHeadline}
            </div>
            <div
              style={{
                position: "relative",
                font: "var(--fw-semibold) 16px/1.5 var(--font-sans)",
                color: "rgba(255,255,255,.88)",
                marginTop: 14,
              }}
            >
              {liveSub}
            </div>
          </div>

          {members.map((m) => (
            <div
              key={m.id}
              className="ttLiveCard"
              style={{
                borderRadius: "calc(26px * var(--radius-scale, 1))",
                padding: "clamp(14px, 2.4vw, 28px)",
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                boxShadow: "var(--shadow-sm)",
                minHeight: "clamp(150px, 26vw, 270px)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <span
                style={{
                  alignSelf: "flex-start",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  borderRadius: 999,
                  padding: "6px 12px",
                  font: "var(--fw-semibold) 11.5px/1 var(--font-sans)",
                  ...(m.busy || walkInsClosed
                    ? { background: "var(--surface-sunken)", color: "var(--text-body)" }
                    : { background: "var(--success-soft)", color: "var(--success-soft-fg)" }),
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: m.busy || walkInsClosed ? "var(--text-subtle)" : "var(--success)",
                  }}
                />
                {walkInsClosed
                  ? t.microsite.sections.closedNow
                  : m.busy
                    ? t.microsite.sections.inService
                    : t.microsite.sections.freeNow}
              </span>

              <div
                style={{
                  font: "var(--fw-extrabold) clamp(18px, 1.9vw, 26px)/1.1 var(--font-sans)",
                  letterSpacing: "-.03em",
                  color: "var(--text-strong)",
                  marginTop: "clamp(12px, 1.6vw, 18px)",
                  overflowWrap: "break-word",
                }}
              >
                {m.name}
              </div>
              <div
                style={{
                  font: "var(--fw-medium) 13.5px/1.45 var(--font-sans)",
                  color: "var(--text-muted)",
                  marginTop: "clamp(6px, 1.2vw, 10px)",
                }}
              >
                {m.role}
              </div>

              {/* Live counters are walk-in information. Closed, the row is removed rather than
                  zeroed: "0 min wait" beside a Closed chip reads as an invitation. */}
              {!walkInsClosed && (
              <div style={{ display: "flex", gap: "clamp(18px, 2vw, 26px)", marginTop: "auto", paddingTop: "clamp(14px, 2vw, 26px)" }}>
                {[
                  {
                    v: m.wait,
                    l: t.microsite.sections.waitCell,
                    c: m.busy ? "var(--text-strong)" : "var(--success)",
                  },
                  { v: String(m.count), l: t.microsite.sections.waitingCell, c: "var(--text-strong)" },
                ].map((cell) => (
                  <div key={cell.l}>
                    <div
                      style={{
                        font: "var(--fw-extrabold) clamp(19px, 2.4vw, 32px)/1 var(--font-sans)",
                        letterSpacing: "-.03em",
                        color: cell.c,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {cell.v}
                    </div>
                    <div
                      style={{
                        font: "var(--fw-medium) 12px/1 var(--font-sans)",
                        letterSpacing: ".04em",
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                        color: "var(--text-subtle)",
                        marginTop: "clamp(5px, 1vw, 9px)",
                      }}
                    >
                      {cell.l}
                    </div>
                  </div>
                ))}
              </div>
              )}

              <div style={{ marginTop: walkInsClosed ? "auto" : "clamp(12px, 2vw, 22px)", paddingTop: walkInsClosed ? "clamp(14px, 2vw, 26px)" : undefined }}>
                <Button variant="outline" fullWidth onClick={() => onJoin(m.id)}>
                  {ctaLabel(m.name)}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </>
  );
}

/* ------------------------------------------------------------ stat cards */

export interface StatCard {
  icon: "calendar" | "star" | "hourglass" | "users";
  value: string;
  label: string;
}

/** v3's four icon cards, sitting directly under the live grid. */
export function StatCards({ cards }: { cards: StatCard[] }) {
  if (cards.length === 0) return null;
  return (
    <Reveal>
      <div className="ttStatGrid" style={{ marginTop: 16 }}>
        {cards.map((c) => (
          // Styling lives in salon.css rather than inline: a phone has to shrink the value and
          // padding, and an inline style cannot be overridden by a media query.
          <div key={c.label} className="ttStatCard">
            <span className="ttStatIcon">
              <Icon name={c.icon} size={19} />
            </span>
            <div className="ttStatValue">{c.value}</div>
            <div className="ttStatLabel">{c.label}</div>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

/* --------------------------------------------------------------- services */

/** Kept in step with the `nth-child(n + 10)` rule in salon.css that hides the overflow. */
const MOBILE_SERVICE_LIMIT = 9;

export interface ServiceItem {
  id: string;
  name: string;
  dur: string;
  /**
   * Already-rendered price ("$45", "Price varies") rather than a number.
   *
   * A price of zero is how the product stores "not priced yet", and rendering that as "$0" told
   * every customer the service was free. Formatting happens once, next to the currency, so no
   * caller can reintroduce a bare `{symbol}{number}`.
   */
  priceLabel: string;
}

/**
 * Services as a dense menu grid.
 *
 * This was a numbered editorial list — one full-width row per service, name at clamp(19px, 31px).
 * It reads beautifully for four treatments and like an invoice for thirty, which is what most
 * salons actually have. The grid keeps a long menu scannable without making a short one look
 * unfinished: cards size to their content, so two services sit as two deliberate cards rather
 * than two stretched bands.
 *
 * Columns (1 / 2 / 3) are CSS at the shared 641 and 1120 breakpoints — see `.ttServiceGrid` in
 * salon.css — so the server render is already correct at every width, with no isMobile branch.
 */
export function ServiceList({
  services,
  heading,
  eyebrow,
  note,
  onPick,
}: {
  services: ServiceItem[];
  heading: string;
  eyebrow: string;
  note: string;
  onPick: (id: string) => void;
}) {
  // Phones get the first 9 with a toggle; the CSS decides when that applies, so this stays a
  // single server-correct tree. Desktop has the columns to show everything and ignores it.
  const [expanded, setExpanded] = useState(false);
  const collapsible = services.length > MOBILE_SERVICE_LIMIT;

  return (
    <>
      <SectionHead eyebrow={eyebrow} title={heading} note={note} />
      <Reveal>
        <div
          className="ttServiceGrid"
          style={{ marginTop: 36 }}
          data-collapsed={collapsible && !expanded ? "true" : undefined}
        >
          {services.map((sv, i) => (
            <button
              key={sv.id}
              type="button"
              className="ttServiceCard"
              onClick={() => onPick(sv.id)}
              // The card is the control, so its name has to say what booking it starts — the
              // visible label alone would read as a bare "Book" to a screen reader.
              aria-label={format(t.microsite.sections.bookService, {
                name: sv.name,
                price: sv.priceLabel,
              })}
            >
              <span
                className="ttServiceNum"
                style={{
                  font: "var(--fw-bold) 11px/1 var(--font-sans)",
                  color: "var(--text-subtle)",
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: ".08em",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>

              {/* One line, ellipsised: a long treatment name must not reflow the card and
                  break the grid's even rows. minWidth:0 is what lets it shrink inside flex. */}
              <span
                style={{
                  display: "block",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  font: "var(--fw-semibold) clamp(17px, 1.3vw, 20px)/1.25 var(--font-sans)",
                  letterSpacing: "-.015em",
                  color: "var(--text-strong)",
                }}
                title={sv.name}
              >
                {sv.name}
              </span>

              <span
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  marginTop: "auto",
                }}
              >
                <span
                  style={{
                    font: "var(--fw-medium) 13px/1 var(--font-sans)",
                    color: "var(--text-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {sv.dur}
                </span>
                <span
                  style={{
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                    font: "var(--fw-extrabold) 19px/1 var(--font-sans)",
                    letterSpacing: "-.02em",
                    color: "var(--text-strong)",
                  }}
                >
                  {sv.priceLabel}
                </span>
              </span>

              {/* Always visible, not hover-revealed: on touch there is no hover, and the
                  affordance is the whole point of the card. */}
              <span
                aria-hidden
                className="ttServiceBook"
                style={{
                  font: "var(--fw-semibold) 13px/1 var(--font-sans)",
                  color: "var(--primary)",
                }}
              >
                {t.microsite.sections.book}
              </span>
            </button>
          ))}
        </div>

        {collapsible && !expanded ? (
          <button
            type="button"
            className="ttServiceMore"
            onClick={() => setExpanded(true)}
            style={{
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              marginTop: 12,
              padding: "12px 18px",
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "calc(12px * var(--radius-scale, 1))",
              font: "var(--fw-semibold) 14px/1 var(--font-sans)",
              color: "var(--text-strong)",
              cursor: "pointer",
            }}
          >
            {format(t.microsite.sections.showAllServices, { count: services.length })}
          </button>
        ) : null}
      </Reveal>
    </>
  );
}

/* ---------------------------------------------------------------- gallery */

/** v3 mosaic: first frame spans 2×2, the rest flow densely around it. */
export function GalleryMosaic({
  photos,
  heading,
  onOpen,
}: {
  photos: string[];
  heading: string;
  onOpen: (index: number) => void;
}) {
  return (
    <>
      <Reveal>
        <div style={EYEBROW}>{t.microsite.sections.gallery}</div>
        <h2 style={H2}>{heading}</h2>
      </Reveal>
      <Reveal>
        <div className={photos.length >= 3 ? "ttMosaic ttMosaicFeature" : "ttMosaic"} style={{ marginTop: "clamp(24px, 3.5vw, 44px)" }}>
          {photos.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              onClick={() => onOpen(i)}
              className="ttBentoCell"
              aria-label={format(t.microsite.sections.openPhoto, { index: i + 1, total: photos.length })}
              style={{
                borderRadius: "calc(22px * var(--radius-scale, 1))",
                border: "1px solid var(--border-subtle)",
                background: "var(--surface-page)",
                padding: 0,
                cursor: "pointer",
                position: "relative",
              }}
            >
              <div
                className="ttBentoImg"
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundImage: `url(${src})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
            </button>
          ))}
        </div>
      </Reveal>
    </>
  );
}

/* ---------------------------------------------------------------- reviews */

/** v3 pairs the section head with an oversized rating numeral and five stars. */
export function ReviewsBlock({
  reviews,
  rating,
  reviewCount,
  avatarColors,
}: {
  reviews: { stars: number; text: string; authorName: string }[];
  rating: number;
  reviewCount: number;
  avatarColors: string[];
}) {
  return (
    <>
      <SectionHead
        eyebrow={t.microsite.sections.reviewsEyebrow}
        title={t.microsite.sections.reviewsTitle}
        trailing={
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span
              style={{
                font: "var(--fw-extrabold) clamp(30px, 5vw, 58px)/1 var(--font-sans)",
                letterSpacing: "-.045em",
                color: "var(--text-strong)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {rating.toFixed(1)}
            </span>
            <div>
              <div style={{ display: "flex", gap: 3, color: "var(--warning)" }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Icon key={i} name="star" size={16} fill="currentColor" />
                ))}
              </div>
              <div
                style={{
                  font: "var(--fw-medium) 13.5px/1 var(--font-sans)",
                  color: "var(--text-muted)",
                  marginTop: 9,
                }}
              >
                {/* Not "verified reviews": TejoTime does not verify reviewers, and claiming it
                    on a store's behalf is a claim the platform cannot stand behind. */}
                {format(t.microsite.sections.reviewsCount, { count: reviewCount })}
              </div>
            </div>
          </div>
        }
      />
      <div className="ttReviewGrid" style={{ marginTop: "clamp(24px, 3.5vw, 44px)" }}>
        {reviews.map((r, i) => (
          <Reveal key={i} index={i}>
            <div
              style={{
                borderRadius: "calc(24px * var(--radius-scale, 1))",
                padding: "clamp(18px, 2.8vw, 32px)",
                background: "var(--surface-page)",
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <div
                style={{
                  font: "var(--fw-medium) clamp(16px, 1.5vw, 20px)/1.5 var(--font-sans)",
                  letterSpacing: "-.012em",
                  color: "var(--text-strong)",
                  flex: 1,
                  textWrap: "pretty",
                }}
              >
                {r.text}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 28 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: avatarColors[i % avatarColors.length],
                    color: "var(--text-on-brand)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "var(--fw-bold) 13px/1 var(--font-sans)",
                    flexShrink: 0,
                  }}
                >
                  {r.authorName.charAt(0)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      font: "var(--fw-bold) 14.5px/1.2 var(--font-sans)",
                      color: "var(--text-strong)",
                    }}
                  >
                    {r.authorName}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 2,
                      color: "var(--warning)",
                      marginTop: 6,
                    }}
                  >
                    {Array.from({ length: Math.max(0, Math.min(5, r.stars)) }).map((_, s) => (
                      <Icon key={s} name="star" size={12} fill="currentColor" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- lightbox */

/** Full-screen photo viewer. Not in the v3 mock, kept because the mosaic invites a tap. */
export function Lightbox({
  photos,
  index,
  onClose,
  onStep,
}: {
  photos: string[];
  index: number;
  onClose: () => void;
  onStep: (delta: number) => void;
}) {
  const src = photos[index];
  if (!src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.microsite.sections.photoViewer}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "var(--scrim)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(16px, 4vw, 48px)",
        animation: "ttFade .2s ease",
      }}
    >
      <button
        type="button"
        aria-label={t.microsite.sections.close}
        onClick={onClose}
        style={{
          position: "absolute",
          top: 18,
          right: 18,
          width: 42,
          height: 42,
          borderRadius: "50%",
          border: "none",
          background: "var(--surface-glass)",
          color: "var(--on-hero)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="x" size={20} />
      </button>

      {photos.length > 1 &&
        (["prev", "next"] as const).map((dir) => (
          <button
            key={dir}
            type="button"
            aria-label={dir === "prev" ? t.microsite.sections.prevPhoto : t.microsite.sections.nextPhoto}
            onClick={(e) => {
              e.stopPropagation();
              onStep(dir === "prev" ? -1 : 1);
            }}
            style={{
              position: "absolute",
              [dir === "prev" ? "left" : "right"]: "clamp(8px, 2vw, 28px)",
              top: "50%",
              transform: "translateY(-50%)",
              width: 46,
              height: 46,
              borderRadius: "50%",
              border: "none",
              background: "var(--surface-glass)",
              color: "var(--on-hero)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: "var(--fw-bold) 20px/1 var(--font-sans)",
            }}
          >
            {dir === "prev" ? "‹" : "›"}
          </button>
        ))}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={format(t.microsite.sections.photoIndex, { index: index + 1, total: photos.length })}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: "calc(14px * var(--radius-scale, 1))",
          boxShadow: "var(--shadow-xl)",
          animation: "ttModalIn .34s cubic-bezier(.34,1.4,.5,1) both",
        }}
      />
    </div>
  );
}
