"use client";

import type { CSSProperties, ReactNode } from "react";

import { t } from "@/i18n";

/**
 * TejoTime Design System primitives, ported from the shared kit
 * (`TejoTimeDesignSystem_6077c1`) that the homepage design imports.
 *
 * Every value here is a token, never a literal — the same contract the kit
 * itself keeps, so these render identically wherever the token layer is
 * present (landing page today, microsite/theme-engine surfaces later).
 */

/* ---------------------------------------------------------------- Badge -- */

export type Tone = "neutral" | "primary" | "secondary" | "success" | "warning" | "error" | "info";

const BADGE_TONES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "var(--surface-sunken)", fg: "var(--text-body)" },
  primary: { bg: "var(--primary-soft)", fg: "var(--primary-soft-fg)" },
  secondary: { bg: "var(--secondary-soft)", fg: "var(--secondary-soft-fg)" },
  success: { bg: "var(--success-soft)", fg: "var(--success-soft-fg)" },
  warning: { bg: "var(--warning-soft)", fg: "var(--warning-soft-fg)" },
  error: { bg: "var(--error-soft)", fg: "var(--error-soft-fg)" },
  info: { bg: "var(--info-soft)", fg: "var(--info-soft-fg)" },
};

/** Compact status / category label. */
export function Badge({
  tone = "neutral",
  dot = false,
  size = "md",
  children,
  style,
}: {
  tone?: Tone;
  dot?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
  style?: CSSProperties;
}) {
  const c = BADGE_TONES[tone] ?? BADGE_TONES.neutral;
  const sm = size === "sm";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: c.bg,
        color: c.fg,
        font: `var(--fw-semibold) ${sm ? "11px" : "var(--fs-caption)"}/1 var(--font-sans)`,
        letterSpacing: ".01em",
        padding: sm ? "4px 8px" : "5px 10px",
        borderRadius: "var(--radius-pill)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />}
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- Avatar -- */

const AVATAR_SIZES = { xs: 24, sm: 32, md: 40, lg: 48, xl: 64 } as const;

/** Deterministic soft colour pair, chosen from the name so it never flickers. */
const AVATAR_PALETTE: [string, string][] = [
  ["var(--blue-100)", "var(--blue-700)"],
  ["var(--teal-100)", "var(--teal-700)"],
  ["var(--amber-100)", "var(--amber-700)"],
  ["var(--green-100)", "var(--green-700)"],
  ["var(--red-100)", "var(--red-700)"],
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Circular avatar with an initials fallback. */
export function Avatar({
  name = "",
  src,
  size = "md",
  style,
  className,
}: {
  name?: string;
  src?: string;
  size?: keyof typeof AVATAR_SIZES;
  style?: CSSProperties;
  className?: string;
}) {
  const px = AVATAR_SIZES[size];
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const [bg, fg] = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];

  return (
    <span className={className} style={{ position: "relative", display: "inline-flex", flexShrink: 0, ...style }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar source is arbitrary/remote
        <img
          src={src}
          alt={name}
          width={px}
          height={px}
          style={{ width: px, height: px, borderRadius: "50%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <span
          style={{
            width: px,
            height: px,
            borderRadius: "50%",
            background: bg,
            color: fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: `var(--fw-semibold) ${Math.round(px * 0.4)}px/1 var(--font-sans)`,
          }}
        >
          {initials(name)}
        </span>
      )}
    </span>
  );
}

/* ---------------------------------------------------------- StatusBadge -- */

export type ApptStatus =
  | "waiting"
  | "upcoming"
  | "in-service"
  | "serving"
  | "completed"
  | "cancelled"
  | "no-show"
  | "confirmed";

const STATUS_TONE: Record<ApptStatus, Tone> = {
  waiting: "warning",
  upcoming: "info",
  "in-service": "primary",
  serving: "primary",
  completed: "success",
  cancelled: "neutral",
  "no-show": "error",
  confirmed: "success",
};

/** Status pill; live statuses get a pulsing dot. */
export function StatusBadge({ status, style }: { status: ApptStatus; style?: CSSProperties }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  const c = BADGE_TONES[tone];
  const live = status === "in-service" || status === "serving" || status === "waiting";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: c.bg,
        color: c.fg,
        font: "var(--fw-semibold) var(--fs-caption)/1 var(--font-sans)",
        padding: "5px 10px",
        borderRadius: "var(--radius-pill)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span style={{ position: "relative", width: 7, height: 7 }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "currentColor" }} />
        {live && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: "currentColor",
              animation: "tjPulse 1.6s ease-out infinite",
            }}
          />
        )}
      </span>
      {t.landingData.status[status]}
    </span>
  );
}

/* ------------------------------------------------------ AppointmentCard -- */

/** Queue / appointment row: who, what, when, and where they stand. */
export function AppointmentCard({
  name,
  service,
  time,
  status = "upcoming",
  waitMinutes,
  position,
  style,
}: {
  name: string;
  service: string;
  time?: string;
  status?: ApptStatus;
  waitMinutes?: number;
  position?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="tj-appt-card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-xs)",
        padding: "var(--space-4)",
        ...style,
      }}
    >
      {position != null && (
        <div
          className="tj-appt-pos"
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-md)",
            flexShrink: 0,
            background: "var(--primary-soft)",
            color: "var(--primary-soft-fg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "var(--fw-bold) var(--fs-h5)/1 var(--font-sans)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {position}
        </div>
      )}
      <Avatar name={name} size="md" className="tj-appt-avatar" />
      <div className="tj-appt-meta" style={{ flex: 1, minWidth: 0 }}>
        <div
          className="tj-appt-name"
          style={{
            font: "var(--fw-semibold) var(--fs-body-md)/1.3 var(--font-sans)",
            color: "var(--text-strong)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </div>
        <div
          className="tj-appt-service"
          style={{
            font: "var(--fw-regular) var(--fs-body-sm)/1.4 var(--font-sans)",
            color: "var(--text-muted)",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {service}
          {time ? ` · ${time}` : ""}
        </div>
      </div>
      <div
        className="tj-appt-status"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <StatusBadge status={status} />
        {waitMinutes != null && (
          <span
            className="tj-appt-wait"
            style={{
              font: "var(--fw-medium) var(--fs-body-sm)/1 var(--font-sans)",
              color: "var(--text-muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {t.landingData.waitApprox.replace("{minutes}", String(waitMinutes))}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------ WaitTimeWidget -- */

const WAIT_TONES = {
  secondary: { fg: "var(--secondary)", bg: "var(--secondary-soft)" },
  primary: { fg: "var(--primary)", bg: "var(--primary-soft)" },
  warning: { fg: "var(--warning)", bg: "var(--warning-soft)" },
} as const;

/** Estimated-wait readout with an hourglass and an emphasised figure. */
export function WaitTimeWidget({
  minutes,
  label,
  tone = "secondary",
  size = "md",
  style,
}: {
  minutes: number;
  label: string;
  tone?: keyof typeof WAIT_TONES;
  size?: "md" | "lg";
  style?: CSSProperties;
}) {
  const c = WAIT_TONES[tone] ?? WAIT_TONES.secondary;
  const big = size === "lg";
  const value =
    minutes >= 60
      ? t.landingData.waitHoursMinutes
          .replace("{hours}", String(Math.floor(minutes / 60)))
          .replace("{minutes}", String(minutes % 60))
      : t.landingData.waitMinutes.replace("{minutes}", String(minutes));

  return (
    <div
      className="tj-wait-widget"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        background: c.bg,
        borderRadius: "var(--radius-lg)",
        padding: big ? "var(--space-5)" : "var(--space-3) var(--space-4)",
        ...style,
      }}
    >
      <span
        style={{
          display: "flex",
          width: big ? 44 : 36,
          height: big ? 44 : 36,
          borderRadius: "var(--radius-md)",
          background: "var(--surface-card)",
          alignItems: "center",
          justifyContent: "center",
          color: c.fg,
          flexShrink: 0,
        }}
      >
        <svg
          width={big ? 24 : 20}
          height={big ? 24 : 20}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2" />
        </svg>
      </span>
      <div>
        <div style={{ font: "var(--fw-medium) var(--fs-body-sm)/1 var(--font-sans)", color: "var(--text-muted)" }}>
          {label}
        </div>
        <div
          style={{
            font: `var(--fw-bold) ${big ? "var(--fs-h3)" : "var(--fs-h5)"}/1.1 var(--font-sans)`,
            color: c.fg,
            marginTop: 4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
