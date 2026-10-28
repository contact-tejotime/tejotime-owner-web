"use client";

import { useEffect, useId, useState } from "react";
import { t, format } from "@/i18n";

import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";
import PhoneField from "@/components/PhoneField";
import { Spinner } from "@/components/Skeleton";
import { StylistOption } from "@/components/series/RescheduleSheet";
import { formatServicePrice } from "@/lib/format";
import { combineToE164, countryByDial, DEFAULT_DIAL_CODE, DEFAULT_ISO2, isValidNational } from "@/lib/phone";
import { weekdayOf, zonedYmd, type PickerContext } from "@/lib/series";
import type { ServiceRow, SlotOption, SlotsResponse } from "@/lib/server-api";
import { showToast } from "@/lib/toast";
import "@/styles/shell-sheets.css";
import "@/styles/series.css";

type VisitorType = "mr" | "patient";

/** As WalkInSheet: the category where the visitor is identified as MR or Patient. */
const VISITOR_TYPE_CATEGORIES = new Set(["Hospital"]);
/** As WalkInSheet / the app: the service accent bar is coloured by list position. */
const ACCENTS = ["primary", "secondary", "amber500", "green500"] as const;

interface ApiError {
  error?: { code?: string; message?: string };
}

/**
 * Book appointment — the Appointments tab's "+" (docs/owner-book-appointment.md). The app's twin is
 * `app/src/components/feedback/BookAppointmentSheet.tsx`.
 *
 * The walk-in sheet's top half — name, phone, (Hospital) visitor type, the service checklist — and
 * the booking picker's bottom half: day, stylist, a free time. The phone is REQUIRED (owner,
 * 2026-10-28): it links the visit to a customer record, and a number already on the books is that
 * customer, never a duplicate. Nothing is booked until "Book appointment" — a time only highlights.
 *
 * The API judges the time exactly as it judges a customer's own booking (`POST /appointments`):
 * free times come from `/api/appointments/slots` for these services, stylist and day, and a time
 * taken meanwhile is a 409 that re-reads the times. No SMS (owner surfaces are never an opt-in path).
 *
 * Mounted only while open, so every field starts fresh (see WalkInSheet).
 */
export function NewAppointmentSheet({
  onClose,
  onBooked,
  picker,
  services,
  category,
  countryCode,
}: {
  onClose: () => void;
  /** The visit is booked (the sheet has toasted). The caller closes it and refreshes. */
  onBooked: () => void;
  /** Stylists (a staff login: only its own chair, no "Any"), the store's zone and closed weekdays. */
  picker: PickerContext;
  services: ServiceRow[];
  category?: string | null;
  /** The store's dial code ("91"), so the phone field starts on the store's country. */
  countryCode?: string | null;
}) {
  const nameId = useId();
  const phoneId = useId();
  const dayId = useId();
  const staffLabelId = useId();
  const timeId = useId();

  const startCountry = (countryCode && countryByDial(countryCode)) || null;
  const [name, setName] = useState("");
  const [phoneCountry, setPhoneCountry] = useState({
    dialCode: startCountry?.dialCode ?? DEFAULT_DIAL_CODE,
    iso2: startCountry?.iso2 ?? DEFAULT_ISO2,
  });
  const [national, setNational] = useState("");
  const [visitorType, setVisitorType] = useState<VisitorType | null>(null);
  // The first service starts ticked, as on the walk-in sheet.
  const [serviceIds, setServiceIds] = useState<string[]>(() => (services[0] ? [services[0].id] : []));
  const [date, setDate] = useState(() => zonedYmd(new Date().toISOString(), picker.zone));
  const [staffId, setStaffId] = useState<string | null>(() =>
    picker.staff.length === 0 ? null : picker.allowAny ? "any" : picker.staff[0].id,
  );
  const [range, setRange] = useState<{ min: string; max: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; slots: SlotOption[]; error: string } | null>(null);
  const [chosen, setChosen] = useState<SlotOption | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const needsVisitorType = VISITOR_TYPE_CATEGORIES.has(category ?? "");
  // A store with services needs at least one: their length sets the free times.
  const needService = services.length > 0 && serviceIds.length === 0;
  const selectedMinutes = services.filter((s) => serviceIds.includes(s.id)).reduce((n, s) => n + s.durationMinutes, 0);

  // One key per request; an answer for an older key (the owner kept clicking) is not shown.
  const key = `${date}|${staffId ?? ""}|${serviceIds.join(",")}|${reload}`;
  const loading = !result || result.key !== key;

  useEffect(() => {
    if (needService) return;
    let alive = true;
    const params = new URLSearchParams({ date });
    if (staffId) params.set("staffId", staffId);
    if (serviceIds.length) params.set("serviceIds", serviceIds.join(","));
    (async () => {
      try {
        const res = await fetch(`/api/appointments/slots?${params}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as SlotsResponse & ApiError;
        if (!alive) return;
        if (!res.ok) {
          setResult({ key, slots: [], error: json?.error?.message ?? t.common.thatDidntWork });
          return;
        }
        setRange({ min: json.today, max: json.lastDay });
        // The device's day can be ahead of or behind the store's: start on the store's today.
        if (date < json.today) {
          setDate(json.today);
          return;
        }
        setResult({ key, slots: json.slots ?? [], error: "" });
      } catch {
        if (alive) setResult({ key, slots: [], error: t.appointments.networkError });
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, date, staffId, serviceIds, needService]);

  /** Anything that changes the length, stylist or day drops the picked time. */
  function changed() {
    setChosen(null);
    setError("");
  }

  function toggleService(id: string) {
    changed();
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setError("");
    if (!name.trim()) return setError(t.walkin.errName);
    if (!isValidNational(national, phoneCountry.iso2)) return setError(t.bookAppt.errPhone);
    if (needsVisitorType && !visitorType) return setError(t.walkin.errVisitorType);
    if (needService) return setError(t.reschedule.pickService);
    if (!chosen) return setError(t.bookAppt.errTime);
    setBusy(true);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: combineToE164(phoneCountry.dialCode, national),
          serviceIds,
          slotStart: chosen.startAt,
          ...(staffId ? { staffId } : {}),
          ...(visitorType ? { visitorType } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ApiError;
      if (!res.ok) {
        setError(json?.error?.message ?? t.common.thatDidntWork);
        // Taken while the sheet was open: show what is free now.
        if (res.status === 409) {
          setChosen(null);
          setReload((r) => r + 1);
        }
        return;
      }
      showToast(t.reschedule.visitBooked, "success");
      onBooked();
    } catch {
      setError(t.appointments.networkError);
    } finally {
      setBusy(false);
    }
  }

  const closedDay = picker.closedDays.includes(weekdayOf(date));
  const slots = loading ? [] : result!.slots;

  return (
    <BottomSheet onClose={onClose} closeLabel={t.walkin.close} label={t.bookAppt.title} className="wk-sheet">
      <h2 className="wk-title">{t.bookAppt.title}</h2>

      <div className="wk-scroll rs">
        <div className="field">
          <label htmlFor={nameId}>{t.walkin.nameLabel}</label>
          <input
            id={nameId}
            placeholder={t.walkin.namePlaceholder}
            value={name}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
          />
        </div>

        <PhoneField
          id={phoneId}
          label={t.walkin.phoneLabel}
          placeholder={t.walkin.phonePlaceholder}
          required
          value={{ dialCode: phoneCountry.dialCode, national, iso2: phoneCountry.iso2 }}
          onChange={(v) => {
            setPhoneCountry({ dialCode: v.dialCode, iso2: v.iso2 });
            setNational(v.national);
            setError("");
          }}
        />

        {needsVisitorType ? (
          <>
            <p className="wk-label" id={`${nameId}-visitor`}>
              {t.walkin.visitorType}
            </p>
            <div className="ss-seg" role="radiogroup" aria-labelledby={`${nameId}-visitor`}>
              {(["mr", "patient"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={visitorType === v}
                  className="ss-seg-btn"
                  onClick={() => {
                    setVisitorType(v);
                    setError("");
                  }}
                >
                  {v === "mr" ? t.queue.mr : t.queue.patient}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {services.length > 0 ? (
          <>
            <p className="wk-label">{t.walkin.service}</p>
            <div className="wk-list">
              {services.map((s, i) => {
                const on = serviceIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className="wk-service"
                    disabled={busy}
                    onClick={() => toggleService(s.id)}
                  >
                    <span className={`wk-service-accent wk-accent-${ACCENTS[i % ACCENTS.length]}`} aria-hidden />
                    <span className="wk-tick" aria-hidden>
                      {on ? <Icon name="check" size={13} strokeWidth={3} /> : null}
                    </span>
                    <span className="wk-service-body">
                      <span className="wk-service-name">{s.name}</span>
                      <span className="wk-service-dur">
                        <Icon name="clock" size={14} />
                        {format(t.walkin.minShort, { mins: s.durationMinutes })}
                      </span>
                    </span>
                    <span className="wk-service-price">{formatServicePrice(s)}</span>
                  </button>
                );
              })}
            </div>
            {serviceIds.length > 0 ? (
              <p className="wk-summary">
                {format(t.walkin.servicesSelected, { count: serviceIds.length, minutes: selectedMinutes })}
              </p>
            ) : null}
          </>
        ) : null}

        <label className="wk-label rs-label" htmlFor={dayId}>
          {t.reschedule.day}
        </label>
        <input
          id={dayId}
          type="date"
          className="rs-date"
          value={date}
          min={range?.min}
          max={range?.max}
          onChange={(e) => {
            if (e.target.value) {
              setDate(e.target.value);
              changed();
            }
          }}
        />

        {picker.staff.length > 0 ? (
          <>
            <p className="wk-label rs-label" id={staffLabelId}>
              {t.reschedule.stylist}
            </p>
            <div className="wk-list" role="radiogroup" aria-labelledby={staffLabelId}>
              {picker.allowAny ? (
                <StylistOption
                  checked={staffId === "any"}
                  onSelect={() => {
                    setStaffId("any");
                    changed();
                  }}
                  avatar={<Icon name="sparkles" size={15} />}
                  avatarClass="auto"
                  label={t.reschedule.anyStylist}
                />
              ) : null}
              {picker.staff.map((st) => (
                <StylistOption
                  key={st.id}
                  checked={staffId === st.id}
                  onSelect={() => {
                    setStaffId(st.id);
                    changed();
                  }}
                  avatar={st.name[0]}
                  avatarClass={`seat-avatar-${st.colorToken || "secondary"}`}
                  label={st.name}
                />
              ))}
            </div>
          </>
        ) : null}

        <p className="wk-label rs-label" id={timeId}>
          {t.reschedule.time}
        </p>
        {needService ? (
          <p className="rs-state">{t.reschedule.pickService}</p>
        ) : loading ? (
          <p className="rs-state" role="status">
            <Spinner size={14} />
            {t.reschedule.loadingTimes}
          </p>
        ) : result!.error ? (
          <p className="ss-error" role="alert">
            {result!.error}
          </p>
        ) : slots.length === 0 ? (
          <p className="rs-state">{closedDay ? t.reschedule.closedDay : t.reschedule.noTimes}</p>
        ) : (
          <div className="rs-slots" role="radiogroup" aria-labelledby={timeId}>
            {slots.map((slot) => (
              <button
                key={slot.startAt}
                type="button"
                role="radio"
                aria-checked={chosen?.startAt === slot.startAt}
                className="rs-slot"
                disabled={busy}
                onClick={() => {
                  setChosen(slot);
                  setError("");
                }}
              >
                {slot.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wk-footer">
        {error ? (
          <p className="ss-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="ss-btn primary lg block" onClick={submit} disabled={busy}>
          {busy ? <Spinner size={16} /> : null}
          {t.bookAppt.submit}
        </button>
        <p className="wk-hint">{t.reschedule.noText}</p>
      </div>
    </BottomSheet>
  );
}
