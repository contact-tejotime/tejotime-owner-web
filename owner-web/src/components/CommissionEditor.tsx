"use client";

import { useRouter } from "next/navigation";
import { t, format } from "@/i18n";
import { useState, useTransition, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";
import { EditSheet } from "@/components/store-settings/EditSheet";
import { SbEmpty, SbField } from "@/components/store-settings/ui";
import {
  formatDayKey,
  formatDayRange,
  formatRate,
  isDayKey,
  parseRateInput,
  rateInputValue,
  shiftDayKey,
} from "@/lib/commission";
import type { CommissionRateItem, CommissionRates, CommissionStaffRates } from "@/lib/server-api";
import { showToast } from "@/lib/toast";

/**
 * Commission rates — the web twin of the app's settings/commission.tsx + CommissionEditSheet.
 *
 * A rate is dated: it applies to every visit from the start of the day it begins, in the store's
 * timezone, until the next one. "20% from 2 Oct, 30% from 16 Oct" pays the first fortnight at 20%
 * for ever — the reports never re-price a day that is over. So:
 *
 *  - the start date defaults to the store's today (from the API, never this browser's clock — the
 *    owner may be travelling, and the server renders in UTC) and cannot be earlier;
 *  - saving again for the same day replaces that day's rate;
 *  - a scheduled change, or today's, can be removed; earlier rates are history and are locked.
 *
 * The API enforces every one of these (409 COMMISSION_RATE_LOCKED); this screen only explains them.
 */
export function CommissionEditor({ rates }: { rates: CommissionRates }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [busy, setBusy] = useState(false);

  // Read from the latest props, so the open sheet shows what router.refresh() just brought back.
  const editing = rates.data.find((s) => s.staffId === editingId) ?? null;

  function openSheet(staffId: string) {
    setEditingId(staffId);
    setOpenCount((n) => n + 1);
    setOpen(true);
  }

  async function send(url: string, method: string, body: unknown, ok: string, fail: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const locked = json?.error?.code === "COMMISSION_RATE_LOCKED";
        showToast(locked ? t.commission.locked : (json?.error?.message ?? fail), "error");
        // Locked usually means the store's day rolled over while the sheet was open: refresh, so
        // the earliest date it offers is the new today.
        if (locked) startTransition(() => router.refresh());
        return false;
      }
      showToast(ok, "success");
      startTransition(() => router.refresh());
      return true;
    } catch {
      showToast(t.commission.networkError, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(staffId: string, rateBp: number, effectiveFrom: string) {
    const done = await send(
      `/api/commission/rates/${staffId}`,
      "PUT",
      { rateBp, effectiveFrom },
      t.commission.saved,
      t.commission.errSave,
    );
    if (done) setOpen(false);
  }

  function remove(staffId: string, day: string) {
    void send(
      `/api/commission/rates/${staffId}/${day}`,
      "DELETE",
      undefined,
      t.commission.removed,
      t.commission.errRemove,
    );
  }

  if (rates.data.length === 0) return <SbEmpty icon="users" title={t.commission.empty} />;

  return (
    <>
      <ul className="sb-list">
        {rates.data.map((s) => {
          const next = s.upcoming[0];
          const sub = [
            s.current ? format(t.commission.since, { rate: formatRate(s.current.rateBp), day: formatDayKey(s.current.from) }) : t.commission.noRate,
            next ? format(t.commission.from, { rate: formatRate(next.rateBp), day: formatDayKey(next.from) }) : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={s.staffId} className="sb-list-item">
              <button
                type="button"
                className="sb-item"
                onClick={() => openSheet(s.staffId)}
                title={format(t.commission.editAria, { name: s.name })}
              >
                <span className="sb-avatar sb-tone-primary" aria-hidden>
                  {s.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="sb-item-body">
                  <span className="sb-item-name">{s.name}</span>
                  <span className="sb-item-sub">{sub}</span>
                </span>
                <span className={`cm-chip${s.current ? "" : " is-none"}`}>
                  {s.current ? formatRate(s.current.rateBp) : t.commission.noRate}
                </span>
                <Icon name="chevronRight" size={18} className="sb-item-icon" />
              </button>
            </li>
          );
        })}
      </ul>

      <EditSheet
        open={open}
        title={editing ? format(t.commission.editTitle, { name: editing.name }) : t.commission.title}
        locked={busy}
        onClose={() => setOpen(false)}
      >
        {open && editing ? (
          <RateForm
            key={openCount}
            staff={editing}
            today={rates.today}
            busy={busy}
            onSave={(bp, day) => void save(editing.staffId, bp, day)}
            onRemove={(day) => remove(editing.staffId, day)}
          />
        ) : null}
      </EditSheet>
    </>
  );
}

/** Remounted per opening (via key) so its fields seed from props without effects. */
function RateForm({
  staff,
  today,
  busy,
  onSave,
  onRemove,
}: {
  staff: CommissionStaffRates;
  today: string;
  busy: boolean;
  onSave: (rateBp: number, effectiveFrom: string) => void;
  onRemove: (day: string) => void;
}) {
  const [rate, setRate] = useState(staff.current ? rateInputValue(staff.current.rateBp) : "");
  const [from, setFrom] = useState(today);
  const [rateError, setRateError] = useState("");
  const [fromError, setFromError] = useState("");
  // The rate awaiting a second tap on "Yes, remove" — no modal over a modal.
  const [confirming, setConfirming] = useState<string | null>(null);
  const latest = shiftDayKey(today, 365);

  function submit(e: FormEvent) {
    e.preventDefault();
    const bp = parseRateInput(rate);
    const dayOk = isDayKey(from) && from >= today && from <= latest;
    setRateError(bp == null ? t.commission.rateInvalid : "");
    setFromError(dayOk ? "" : t.commission.startsInvalid);
    if (bp == null || !dayOk) return;
    onSave(bp, from);
  }

  const removable: CommissionRateItem[] = [
    ...(staff.current?.editable ? [staff.current] : []),
    ...staff.upcoming,
  ];

  return (
    <form className="sb-form" onSubmit={submit} noValidate>
      <p className="cm-current">
        <span className="cm-current-label">{t.commission.current}</span>
        <span className="cm-current-value">
          {staff.current
            ? format(t.commission.since, {
                rate: formatRate(staff.current.rateBp),
                day: formatDayKey(staff.current.from, { year: true }),
              })
            : t.commission.noRate}
        </span>
      </p>

      <SbField id="cm-rate" label={t.commission.rateLabel} hint={t.commission.rateHint} error={rateError}>
        <input
          id="cm-rate"
          inputMode="decimal"
          autoComplete="off"
          value={rate}
          onChange={(e) => {
            setRate(e.target.value);
            setRateError("");
          }}
          placeholder="20"
          data-autofocus
          maxLength={6}
        />
      </SbField>

      <SbField
        id="cm-from"
        label={t.commission.startsLabel}
        hint={isDayKey(from) ? format(t.commission.startsHint, { day: formatDayKey(from, { weekday: true, year: true }) }) : undefined}
        error={fromError}
      >
        <input
          id="cm-from"
          type="date"
          min={today}
          max={latest}
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setFromError("");
          }}
        />
      </SbField>

      <button type="submit" className="sb-btn sb-btn--primary sb-btn--lg sb-btn--block" disabled={busy}>
        {busy ? <Spinner size={16} /> : null}
        {t.commission.save}
      </button>

      {removable.length ? (
        <section className="cm-list" aria-label={t.commission.scheduledTitle}>
          <h3 className="cm-list-title">{t.commission.scheduledTitle}</h3>
          <ul>
            {removable.map((r) => (
              <li key={r.from} className="cm-list-row">
                <span className="cm-list-text">
                  {format(t.commission.from, { rate: formatRate(r.rateBp), day: formatDayKey(r.from, { year: true }) })}
                </span>
                {confirming === r.from ? (
                  <span className="cm-confirm">
                    <span className="cm-confirm-q">{t.commission.removeConfirm}</span>
                    <button type="button" className="sb-link-danger" disabled={busy} onClick={() => onRemove(r.from)}>
                      {t.commission.removeYes}
                    </button>
                    <button type="button" className="cm-keep" disabled={busy} onClick={() => setConfirming(null)}>
                      {t.commission.keep}
                    </button>
                  </span>
                ) : (
                  <button type="button" className="sb-link-danger" disabled={busy} onClick={() => setConfirming(r.from)}>
                    {t.commission.remove}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {staff.history.length ? (
        <section className="cm-list" aria-label={t.commission.historyTitle}>
          <h3 className="cm-list-title">{t.commission.historyTitle}</h3>
          <ul>
            {staff.history.map((r) => (
              <li key={r.from} className="cm-list-row is-locked">
                <span className="cm-list-text">
                  {`${formatRate(r.rateBp)} · ${r.to ? formatDayRange(r.from, r.to) : formatDayKey(r.from)}`}
                </span>
                <Icon name="lock" size={14} className="cm-lock" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </form>
  );
}
