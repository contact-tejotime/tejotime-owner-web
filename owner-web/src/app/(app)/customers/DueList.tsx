"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, t } from "@/i18n";

import { Icon } from "@/components/Icon";
import { useBookingSheets } from "@/components/series/BookingSheets";
import { dateLabel, telHref } from "@/lib/series";
import { DUE_SECTIONS, dueBookFrom, dueHiddenLabel, dueLastLine, dueRhythmLine, dueStatusLabel } from "@/lib/due";
import { formatPhone } from "@/lib/format";
import type { DueCustomer, DueList as DueListData } from "@/lib/server-api";
import { showToast } from "@/lib/toast";
import "@/styles/customers-due.css";

import { LaterSheet } from "./LaterSheet";

type FollowupBody = { outcome: "no_answer" } | { outcome: "call_later"; callBackOn: string } | { outcome: "not_interested" };

interface ApiError {
  error?: { message?: string };
}

/** The app's initials rule, as on CustomerCard. */
function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * "Due to come back" — the call list on Customers (docs/customer-due-list.md). The app's twin is
 * `app/src/app/(app)/(tabs)/customers.tsx` (Due view) + `components/customers/DueCard.tsx`.
 *
 * Who is due, and in which section, is the API's answer (`GET /customers/due`); this only lays it
 * out and sends what a call achieved. Hiding is optimistic — a row leaves at once and the page is
 * refreshed behind it — and "Not interested" offers Undo on the toast; every hidden row also stays
 * reachable under "Hidden", with its own Undo.
 *
 * Book opens the shared booking sheet (BookingSheetsHost, from the page) on the customer's expected
 * day with their last services and stylist.
 */
export function DueList({
  list,
  zone,
  canBook,
  canLog,
}: {
  list: DueListData;
  zone: string;
  /** `appointments: manage` — POST /appointments. */
  canBook: boolean;
  /** `customers: manage` — logging what a call achieved. */
  canLog: boolean;
}) {
  const router = useRouter();
  const host = useBookingSheets();
  const [, startTransition] = useTransition();
  // Rows hidden (with why) or restored here before the refreshed list arrives, keyed by customer.
  const [local, setLocal] = useState<Record<string, { hidden: boolean; reason?: string }>>({});
  const [later, setLater] = useState<DueCustomer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const isHidden = (c: DueCustomer, fromServer: boolean) => local[c.customerId]?.hidden ?? fromServer;
  const visible = [...list.data.filter((c) => !isHidden(c, false)), ...list.hidden.filter((c) => !isHidden(c, true))];
  const hidden = [...list.hidden.filter((c) => isHidden(c, true)), ...list.data.filter((c) => isHidden(c, false))];

  const refresh = () => startTransition(() => router.refresh());

  async function send(c: DueCustomer, method: "PUT" | "DELETE", body?: FollowupBody): Promise<boolean> {
    setBusy(c.customerId);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(c.customerId)}/followup`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as ApiError;
        showToast(json?.error?.message ?? t.common.thatDidntWork, "error");
        return false;
      }
      return true;
    } catch {
      showToast(t.customers.due.networkError, "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function undo(c: DueCustomer) {
    const before = local[c.customerId];
    setLocal((m) => ({ ...m, [c.customerId]: { hidden: false } }));
    if (await send(c, "DELETE")) {
      showToast(t.customers.due.undone, "success");
      refresh();
    } else {
      setLocal((m) => ({ ...m, [c.customerId]: before ?? { hidden: true } }));
    }
  }

  async function log(c: DueCustomer, body: FollowupBody) {
    const reason =
      body.outcome === "not_interested"
        ? t.customers.due.reasonNotInterested
        : format(t.customers.due.reasonSnoozed, {
            date: dateLabel(body.outcome === "call_later" ? body.callBackOn : list.callBackRange.min, zone),
          });
    setLocal((m) => ({ ...m, [c.customerId]: { hidden: true, reason } }));
    setLater(null);
    if (!(await send(c, "PUT", body))) {
      setLocal((m) => ({ ...m, [c.customerId]: { hidden: false } }));
      return;
    }
    const message =
      body.outcome === "not_interested"
        ? t.customers.due.hiddenNotInterested
        : body.outcome === "no_answer"
          ? t.customers.due.hiddenNoAnswer
          : format(t.customers.due.hiddenUntil, { date: dateLabel(body.callBackOn, zone) });
    showToast(message, "info", { action: { label: t.customers.due.undo, onClick: () => void undo(c) } });
    refresh();
  }

  function book(c: DueCustomer) {
    host?.pick(
      {
        kind: "new",
        customerId: c.customerId,
        initialDate: dueBookFrom(c, list.today),
        staffId: c.lastStaff?.active ? c.lastStaff.id : null,
        serviceIds: c.serviceIds,
        servicesResolved: c.servicesResolved,
      },
      c.name,
    );
  }

  if (visible.length === 0 && hidden.length === 0) {
    return (
      <div className="cu-empty">
        <div className="cu-empty-disc" aria-hidden>
          <Icon name="calendarClock" size={24} />
        </div>
        <p className="cu-empty-title">{t.customers.due.empty}</p>
        <p className="cu-empty-hint">{t.customers.due.emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="due">
      <p className="due-lead">{t.customers.due.subtitle}</p>

      {visible.length === 0 ? <p className="due-none">{t.customers.due.empty}</p> : null}

      {DUE_SECTIONS.map((section) => {
        const rows = visible.filter((c) => c.status === section.status);
        if (rows.length === 0) return null;
        return (
          <section key={section.status} className="due-section" aria-label={section.title}>
            <h2 className="due-section-title">
              {section.title} <span className="due-count">{rows.length}</span>
            </h2>
            <div className="cu-list">
              {rows.map((c) => (
                <DueRow
                  key={c.customerId}
                  c={c}
                  busy={busy === c.customerId}
                  canBook={canBook && !!host}
                  canLog={canLog}
                  onBook={() => book(c)}
                  onLater={() => setLater(c)}
                  onNotInterested={() => void log(c, { outcome: "not_interested" })}
                />
              ))}
            </div>
          </section>
        );
      })}

      {hidden.length > 0 ? (
        <details className="due-hidden">
          <summary>{format(t.customers.due.hidden, { count: hidden.length })}</summary>
          <ul className="due-hidden-list">
            {hidden.map((c) => (
              <li key={c.customerId} className="due-hidden-row">
                <span className="due-hidden-name">{c.name}</span>
                <span className="due-hidden-reason">
                  {local[c.customerId]?.reason ?? dueHiddenLabel(c, zone)}
                </span>
                {canLog ? (
                  <button
                    type="button"
                    className="due-link"
                    disabled={busy === c.customerId}
                    onClick={() => void undo(c)}
                  >
                    {t.customers.due.undo}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {later ? (
        <LaterSheet
          key={later.customerId}
          name={later.name}
          range={list.callBackRange}
          busy={busy === later.customerId}
          onNoAnswer={() => void log(later, { outcome: "no_answer" })}
          onCallBackOn={(day) => void log(later, { outcome: "call_later", callBackOn: day })}
          onClose={() => setLater(null)}
        />
      ) : null}
    </div>
  );
}

function DueRow({
  c,
  busy,
  canBook,
  canLog,
  onBook,
  onLater,
  onNotInterested,
}: {
  c: DueCustomer;
  busy: boolean;
  canBook: boolean;
  canLog: boolean;
  onBook: () => void;
  onLater: () => void;
  onNotInterested: () => void;
}) {
  const tel = telHref(c.phone);
  const last = dueLastLine(c);
  return (
    <article className="cu-card due-card">
      <div className="cu-card-top">
        <div className="cu-avatar" aria-hidden>
          {initials(c.name)}
        </div>
        <div className="cu-card-body">
          <div className="cu-name">{c.name}</div>
          <div className="cu-phone">{formatPhone(c.phone)}</div>
        </div>
        <span className={`due-chip due-chip-${c.status}`}>{dueStatusLabel(c.status)}</span>
      </div>
      <p className="due-line">{dueRhythmLine(c)}</p>
      {last ? <p className="due-line due-line-muted">{last}</p> : null}
      <div className="due-actions">
        {tel ? (
          <a href={tel} className="ss-btn outline due-btn" aria-label={format(t.customers.due.callAria, { name: c.name })}>
            <Icon name="phone" size={16} />
            {t.customers.due.call}
          </a>
        ) : null}
        {canBook ? (
          <button type="button" className="ss-btn primary due-btn" disabled={busy} onClick={onBook}>
            <Icon name="calendarCheck" size={16} />
            {t.customers.due.book}
          </button>
        ) : null}
        {canLog ? (
          <>
            <button type="button" className="ss-btn ghost due-btn" disabled={busy} onClick={onLater}>
              {t.customers.due.later}
            </button>
            <button type="button" className="ss-btn ghost due-btn" disabled={busy} onClick={onNotInterested}>
              {t.customers.due.notInterested}
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

