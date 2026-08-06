"use client";

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

import type { CSSProperties, ReactNode } from "react";

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
  font: "var(--fw-extrabold) clamp(34px, 4.4vw, 60px)/1.02 var(--font-sans)",
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
            "calc(var(--section-y, clamp(44px, 6vw, 84px)) * var(--density-scale, 1)) clamp(18px, 4vw, 30px)",
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
}: {
  members: LiveMember[];
  heading: string;
  queueWord: string;
  liveHeadline: string;
  liveSub: string;
  ctaLabel: (name: string) => string;
  onJoin: (id: string) => void;
}) {
  return (
    <>
      <SectionHead
        eyebrow="Live floor"
        title={heading}
        note={`Pick who you want. The numbers move as the ${queueWord} moves.`}
      />

      <Reveal>
        <div className="ttLiveGrid" style={{ marginTop: 44 }}>
          {/* Summary tile — the store's own brand, dark end of its ramp. */}
          <div
            style={{
              borderRadius: "calc(26px * var(--radius-scale, 1))",
              padding: 34,
              background: "linear-gradient(150deg, var(--primary), var(--brand-900))",
              position: "relative",
              overflow: "hidden",
              minHeight: 270,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: -60,
                top: -60,
                width: 230,
                height: 230,
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
              Wait right now
            </div>
            <div
              style={{
                position: "relative",
                font: "var(--fw-extrabold) clamp(38px, 4.4vw, 56px)/0.98 var(--font-sans)",
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
                font: "var(--fw-semibold) 15px/1.5 var(--font-sans)",
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
                padding: 28,
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                boxShadow: "var(--shadow-sm)",
                minHeight: 270,
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
                  ...(m.busy
                    ? { background: "var(--surface-sunken)", color: "var(--text-body)" }
                    : { background: "var(--success-soft)", color: "var(--success-soft-fg)" }),
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: m.busy ? "var(--text-subtle)" : "var(--success)",
                  }}
                />
                {m.busy ? "In service" : "Free now"}
              </span>

              <div
                style={{
                  font: "var(--fw-extrabold) clamp(21px, 1.9vw, 26px)/1.1 var(--font-sans)",
                  letterSpacing: "-.03em",
                  color: "var(--text-strong)",
                  marginTop: 18,
                  overflowWrap: "break-word",
                }}
              >
                {m.name}
              </div>
              <div
                style={{
                  font: "var(--fw-medium) 13.5px/1.45 var(--font-sans)",
                  color: "var(--text-muted)",
                  marginTop: 10,
                }}
              >
                {m.role}
              </div>

              <div style={{ display: "flex", gap: 26, marginTop: "auto", paddingTop: 26 }}>
                {[
                  { v: m.wait, l: m.busy ? "wait" : "walk in", c: m.busy ? "var(--text-strong)" : "var(--success)" },
                  { v: String(m.count), l: "in line", c: "var(--text-strong)" },
                ].map((cell) => (
                  <div key={cell.l}>
                    <div
                      style={{
                        font: "var(--fw-extrabold) 32px/1 var(--font-sans)",
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
                        marginTop: 9,
                      }}
                    >
                      {cell.l}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 22 }}>
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
          <div
            key={c.label}
            style={{
              borderRadius: "calc(22px * var(--radius-scale, 1))",
              padding: 26,
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              boxShadow: "var(--shadow-xs)",
            }}
          >
            <span style={{ display: "flex", color: "var(--primary)" }}>
              <Icon name={c.icon} size={19} />
            </span>
            <div
              style={{
                font: "var(--fw-extrabold) 34px/1 var(--font-sans)",
                letterSpacing: "-.035em",
                color: "var(--text-strong)",
                marginTop: 22,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {c.value}
            </div>
            <div
              style={{
                font: "var(--fw-medium) 13px/1.4 var(--font-sans)",
                color: "var(--text-muted)",
                marginTop: 10,
              }}
            >
              {c.label}
            </div>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

/* --------------------------------------------------------------- services */

export interface ServiceItem {
  id: string;
  name: string;
  dur: string;
  price: number;
}

/**
 * v3 renders services as a numbered editorial list rather than a card grid — big name, small
 * meta, price hard-right, ghost Book. The category chip in the mock is dropped: the `service`
 * table has no category column, and inventing one client-side would be a lie.
 */
export function ServiceList({
  services,
  heading,
  eyebrow,
  note,
  currencySymbol,
  onPick,
}: {
  services: ServiceItem[];
  heading: string;
  eyebrow: string;
  note: string;
  currencySymbol: string;
  onPick: (id: string) => void;
}) {
  return (
    <>
      <SectionHead eyebrow={eyebrow} title={heading} note={note} />
      <Reveal>
        <div style={{ marginTop: 44, borderTop: "1px solid var(--border-subtle)" }}>
          {services.map((sv, i) => (
            <div
              key={sv.id}
              className="ttServiceRow"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "clamp(14px, 2vw, 26px)",
                padding: "clamp(20px, 2.4vw, 28px) 6px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <span
                style={{
                  font: "var(--fw-bold) 13px/1 var(--font-sans)",
                  color: "var(--text-subtle)",
                  fontVariantNumeric: "tabular-nums",
                  width: 30,
                  flexShrink: 0,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    font: "var(--fw-extrabold) clamp(19px, 2.2vw, 31px)/1.14 var(--font-sans)",
                    letterSpacing: "-.03em",
                    color: "var(--text-strong)",
                  }}
                >
                  {sv.name}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 11,
                    font: "var(--fw-medium) 13.5px/1 var(--font-sans)",
                    color: "var(--text-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {sv.dur}
                </div>
              </div>

              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div
                  style={{
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                    font: "var(--fw-extrabold) clamp(19px, 2vw, 30px)/1 var(--font-sans)",
                    letterSpacing: "-.03em",
                    color: "var(--text-strong)",
                  }}
                >
                  {currencySymbol}
                  {sv.price}
                </div>
                <div style={{ marginTop: 10 }}>
                  <Button variant="ghost" size="sm" onClick={() => onPick(sv.id)}>
                    Book →
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
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
        <div style={EYEBROW}>Gallery</div>
        <h2 style={H2}>{heading}</h2>
      </Reveal>
      <Reveal>
        <div className={photos.length >= 3 ? "ttMosaic ttMosaicFeature" : "ttMosaic"} style={{ marginTop: 44 }}>
          {photos.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              onClick={() => onOpen(i)}
              className="ttBentoCell"
              aria-label={`Open photo ${i + 1} of ${photos.length}`}
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
        eyebrow="Reviews"
        title="What people say"
        trailing={
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span
              style={{
                font: "var(--fw-extrabold) clamp(40px, 5vw, 58px)/1 var(--font-sans)",
                letterSpacing: "-.045em",
                color: "var(--text-strong)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {rating}
            </span>
            <div>
              <div style={{ display: "flex", gap: 3, color: "var(--warning)" }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Icon key={i} name="star" size={16} />
                ))}
              </div>
              <div
                style={{
                  font: "var(--fw-medium) 13.5px/1 var(--font-sans)",
                  color: "var(--text-muted)",
                  marginTop: 9,
                }}
              >
                {reviewCount} verified reviews
              </div>
            </div>
          </div>
        }
      />
      <div className="ttReviewGrid" style={{ marginTop: 44 }}>
        {reviews.map((r, i) => (
          <Reveal key={i} index={i}>
            <div
              style={{
                borderRadius: "calc(24px * var(--radius-scale, 1))",
                padding: 32,
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
                      <Icon key={s} name="star" size={12} />
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
      aria-label="Photo viewer"
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
        aria-label="Close"
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
            aria-label={dir === "prev" ? "Previous photo" : "Next photo"}
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
        alt={`Photo ${index + 1} of ${photos.length}`}
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
