"use client";

import { useState } from "react";
import Link from "next/link";
import { t, format } from "@/i18n";
import type { ApptView, Draft, SlotLite } from "./engine";

/**
 * The cards the guided chat flows draw inside the conversation. Presentational only: every value
 * arrives as a prop from the page, which is what makes the staff, slot and ticket cards LIVE —
 * the page re-renders on each socket push / poll and these re-render with it.
 */

const C = t.chat.flow.card;
const S = t.chat.flow;

type Choose = (id: string, value: unknown, label: string) => void;

export function ServicesCard({
  services,
  initial,
  max,
  active,
  choose,
}: {
  services: { id: string; name: string; priceLabel: string; dur: string }[];
  initial: string[];
  max: number;
  active: boolean;
  choose: Choose;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  if (!active) return null;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= max ? p : [...p, id]));
  const names = picked.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean).join(" + ");
  return (
    <div className="ttFlowCard">
      <div className="ttFlowPickList">
        {services.map((s) => {
          const on = picked.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              className={`ttFlowPick${on ? " isOn" : ""}`}
              aria-pressed={on}
              onClick={() => toggle(s.id)}
            >
              <span className="ttFlowPickMain">{s.name}</span>
              <span className="ttFlowPickSub">{[s.priceLabel, s.dur].filter(Boolean).join(" · ")}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="ttChatOption isPrimary"
        disabled={picked.length === 0}
        onClick={() => choose("services", picked, names)}
      >
        {picked.length === 0 ? S.servicesPickOne : `${S.servicesDone} · ${names}`}
      </button>
    </div>
  );
}

export interface StaffLive {
  id: string;
  name: string;
  busy: boolean;
  count: number;
  waitMin: number;
}

export function StaffCard({
  staff,
  kind,
  anyWaitMin,
  active,
  choose,
}: {
  staff: StaffLive[];
  kind: "join" | "book";
  /** Shop-wide soonest wait, for the "Anyone" chip on a walk-in. */
  anyWaitMin: number;
  active: boolean;
  choose: Choose;
}) {
  if (!active) return null;
  // Walk-ins care about the live wait; a booking for next week does not, so only walk-ins show it.
  const status = (s: StaffLive) =>
    kind === "book"
      ? ""
      : !s.busy && s.count === 0
        ? C.free
        : [s.busy ? C.busy : "", s.waitMin > 0 ? format(C.waitMin, { min: s.waitMin }) : ""].filter(Boolean).join(" · ");
  const anyLabel = kind === "book" ? S.staffAny : S.staffAnyJoin;
  return (
    <div className="ttFlowCard">
      <div className="ttFlowPickList">
        <button type="button" className="ttFlowPick" onClick={() => choose("staff", "any", anyLabel)}>
          <span className="ttFlowPickMain">{anyLabel}</span>
          {kind === "join" && (
            <span className="ttFlowPickSub">{anyWaitMin > 0 ? format(C.waitMin, { min: anyWaitMin }) : C.free}</span>
          )}
        </button>
        {staff.map((s) => (
          <button key={s.id} type="button" className="ttFlowPick" onClick={() => choose("staff", s.id, s.name)}>
            <span className="ttFlowPickMain">{s.name}</span>
            {status(s) && <span className="ttFlowPickSub">{status(s)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

const SLOTS_SHOWN = 12;

export function SlotsCard({
  slots,
  error,
  active,
  choose,
}: {
  /** null while loading. */
  slots: SlotLite[] | null;
  error: boolean;
  active: boolean;
  choose: Choose;
}) {
  const [all, setAll] = useState(false);
  if (!active) return null;
  if (slots === null) return <div className="ttFlowCard ttFlowMuted">{S.slotsLoading}</div>;
  if (error || slots.length === 0) return null;
  // Group by the hour in the label, not by `new Date(startAt).getHours()`: the label is already in
  // the STORE's clock (the API formats it in the store timezone), while getHours() is the viewer's.
  // For a store in another zone the two disagree — a Phoenix store's "9:00 AM" landed under
  // "Evening" for a visitor in India.
  const hourOf = (label: string) => {
    const m = label.match(/(\d{1,2}):\d{2}\s*([AP]M)/i);
    if (!m) return 12;
    return (Number(m[1]) % 12) + (m[2].toUpperCase() === "PM" ? 12 : 0);
  };
  const shown = all ? slots : slots.slice(0, SLOTS_SHOWN);
  const groups: [string, SlotLite[]][] = [
    [C.morning, shown.filter((s) => hourOf(s.label) < 12)],
    [C.afternoon, shown.filter((s) => hourOf(s.label) >= 12 && hourOf(s.label) < 17)],
    [C.evening, shown.filter((s) => hourOf(s.label) >= 17)],
  ];
  return (
    <div className="ttFlowCard">
      {groups
        .filter(([, list]) => list.length > 0)
        .map(([label, list]) => (
          <div key={label} className="ttFlowSlotGroup">
            <div className="ttFlowLabel">{label}</div>
            <div className="ttFlowSlots">
              {list.map((s) => (
                <button key={s.startAt} type="button" className="ttFlowSlot" onClick={() => choose("slot", s.startAt, s.label)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      {!all && slots.length > SLOTS_SHOWN && (
        <button type="button" className="ttChatOption" onClick={() => setAll(true)}>
          {S.moreTimes}
        </button>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="ttFlowRow">
      <span className="ttFlowRowLabel">{label}</span>
      <span className="ttFlowRowValue">{value}</span>
    </div>
  );
}

export function SummaryCard({
  kind,
  draft,
  serviceNames,
  staffName,
  when,
  phone,
  total,
  visitorLabel,
}: {
  kind: "join" | "book";
  draft: Draft;
  serviceNames: string;
  staffName: string;
  when: string;
  phone: string;
  total: string;
  visitorLabel: string;
}) {
  return (
    <div className="ttFlowCard">
      <div className="ttFlowCardTitle">{kind === "book" ? C.summaryBooking : C.summaryCheckIn}</div>
      <Row label={S.visitorQuestion} value={visitorLabel} />
      <Row label={C.services} value={serviceNames} />
      <Row label={C.total} value={total} />
      <Row label={C.staff} value={staffName} />
      <Row label={C.when} value={when} />
      <Row label={C.name} value={draft.name ?? ""} />
      <Row label={C.phone} value={phone} />
      <Row label={C.texts} value={draft.sms ? C.textsYes : C.textsNo} />
    </div>
  );
}

export function TicketCard({
  token,
  status,
  inService,
  ahead,
  waitLabel,
  staffName,
  serviceName,
}: {
  token: string | null;
  status: string | null;
  inService: boolean;
  ahead: number;
  /** Already worded and live ("~12 min", "Almost your turn"); empty hides the tile. */
  waitLabel: string;
  staffName: string | null;
  serviceName: string | null;
}) {
  const active = status === "waiting" || status === "in_service";
  const headline = !active
    ? status === "completed"
      ? C.completed
      : C.cancelled
    : inService
      ? C.yourTurn
      : null;
  return (
    <div className={`ttFlowCard ttFlowTicket${inService && active ? " isTurn" : ""}${active ? "" : " isOver"}`}>
      <div className="ttFlowTicketTop">
        <div>
          <div className="ttFlowLabel">{C.token}</div>
          <div className="ttFlowToken">{token ?? "—"}</div>
        </div>
        {active && !inService && (
          <div style={{ textAlign: "right" }}>
            <div className="ttFlowLabel">{C.ahead}</div>
            <div className="ttFlowBig">{ahead}</div>
          </div>
        )}
      </div>
      {headline && <div className="ttFlowHeadline">{headline}</div>}
      {active && !inService && waitLabel && <Row label={C.wait} value={waitLabel} />}
      {active && <Row label={C.services} value={serviceName ?? ""} />}
      {active && staffName && <Row label={C.staff} value={staffName} />}
    </div>
  );
}

export function AppointmentCard({ appt, when }: { appt: ApptView; when: string }) {
  const statusLabel = (C.status as Record<string, string>)[appt.status] ?? appt.status;
  const over = appt.status === "cancelled" || appt.status === "no_show" || appt.status === "completed";
  return (
    <div className={`ttFlowCard${over ? " isOver" : ""}`}>
      <div className="ttFlowTicketTop">
        <div className="ttFlowCardTitle" style={{ margin: 0 }}>{appt.serviceName || C.summaryBooking}</div>
        <span className={`ttFlowBadge${over ? " isOver" : ""}`}>{statusLabel}</span>
      </div>
      <Row label={C.when} value={when} />
      <Row label={C.staff} value={appt.staffName ?? ""} />
    </div>
  );
}

/**
 * The SMS disclosure, word for word the website checkbox's (consentOptIn), with the same Privacy
 * and SMS Terms links — this is an A2P opt-in path now (docs/sms-opt-in-a2p.md), and reviewers
 * reject a disclosure that differs between entry points or reads as fine print.
 */
export function ConsentCard({ storeName }: { storeName: string }) {
  return (
    <div className="ttFlowCard ttFlowConsent">
      {format(t.microsite.join.consentOptIn, { name: storeName })}{" "}
      <Link href="/privacy">{t.microsite.join.consentPrivacy}</Link>
      {" · "}
      <Link href="/terms">{t.microsite.join.consentSmsTerms}</Link>
    </div>
  );
}
