"use client";

import { useMemo, useState } from "react";
import { t, format } from "@/i18n";
import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";
import PhoneField from "@/components/PhoneField";
import { Spinner } from "@/components/Skeleton";
import { formatServicePrice } from "@/lib/format";
import { showToast } from "@/lib/toast";
import {
  combineToE164,
  DEFAULT_DIAL_CODE,
  DEFAULT_ISO2,
} from "@/lib/phone";
import type { SeatGroup, ServiceRow, StaffRow } from "@/lib/server-api";
import "@/styles/shell-sheets.css";

type WalkInSheetProps = {
  onClose: () => void;
  staff: StaffRow[];
  services: ServiceRow[];
  /**
   * The walk-in is in. The caller closes the sheet (and refreshes, if it shows the queue). The
   * sheet has ALREADY said so — "Added as next" / "Added to queue" — because on the app that toast
   * lives in the one `addWalkin` action every caller shares. When it moved out to the callers,
   * Appointments (which only closes the sheet) went silent on success. A caller must not toast
   * again, or the owner sees two.
   */
  onAdded: (added: { position: "end" | "next" }) => void;
  /**
   * A seat to start on — an empty seat's "add a walk-in here" shortcut. Ignored unless it is one
   * of `staff`, so the seatless "Any" group (not a seat the API accepts) falls back to Any.
   */
  initialSeatId?: string | null;
  /**
   * The live seat boards, for each seat's load line ("Free now" / "2 waiting · ~40m") and for
   * naming the seat "Any seat" would pick. Without them a seat falls back to its role label.
   */
  seats?: SeatGroup[];
  /** Business category — Hospital asks MR or Patient; Hospital/Restaurant make a service optional. */
  category?: string | null;
};

type Position = "end" | "next";
type VisitorType = "mr" | "patient";

/**
 * Mirrors backend/src/config/constants.ts (and the app's store.tsx): categories where a walk-in
 * needs no service, and the one where the visitor must be identified as MR or Patient. Hospital
 * joins used to fail outright from the web, because this sheet never sent the visitor type.
 */
const OPTIONAL_SERVICE_CATEGORIES = new Set(["Hospital", "Restaurant"]);
const VISITOR_TYPE_CATEGORIES = new Set(["Hospital"]);

/**
 * The app has no per-service colour either: it colours the accent bar by list position from this
 * palette (app/src/lib/mappers.ts `COLOR_PALETTE`), so neighbouring services always differ. Same
 * order here, so a service wears the same colour on the phone and the laptop.
 */
const ACCENTS = ["primary", "secondary", "amber500", "green500"] as const;

/**
 * Add a walk-in — the web twin of the app's `AddWalkInSheet`, block for block: name, phone,
 * (Hospital) visitor type, a service CHECKLIST with a running total, the seat picker with each
 * seat's load, and End of queue / Next up.
 *
 * Posts to `/api/queue`, which forwards to the backend's `queue_add` RPC — the same call and the
 * same body the app sends, so token allocation, seat assignment and multi-service visits stay
 * identical on both surfaces.
 *
 * Mounted only while open (the parent renders it conditionally), so every field starts fresh on
 * each open without a reset effect — clearing state inside an effect paints the previous
 * customer's details for one frame before wiping them.
 */
export function WalkInSheet({
  onClose,
  staff,
  services,
  onAdded,
  initialSeatId,
  seats = [],
  category,
}: WalkInSheetProps) {
  // The first service starts ticked, as on the app. Order matters: the first pick becomes the
  // entry's primary service on the API side.
  const [serviceIds, setServiceIds] = useState<string[]>(() => (services[0] ? [services[0].id] : []));
  const [seatId, setSeatId] = useState(() =>
    initialSeatId && staff.some((s) => s.id === initialSeatId) ? initialSeatId : "any",
  );
  const [position, setPosition] = useState<Position>("end");
  const [visitorType, setVisitorType] = useState<VisitorType | null>(null);
  const [name, setName] = useState("");
  const [phoneCountry, setPhoneCountry] = useState({
    dialCode: DEFAULT_DIAL_CODE,
    iso2: DEFAULT_ISO2,
  });
  const [national, setNational] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const cat = category ?? "";
  const needsVisitorType = VISITOR_TYPE_CATEGORIES.has(cat);
  const serviceOptional = OPTIONAL_SERVICE_CATEGORIES.has(cat);

  /** Each seat's load line, and which seat "Any seat" would land on — the app's rule. */
  const seatOptions = useMemo(() => {
    const byId = new Map(seats.map((g) => [g.id, g]));
    let autoName = staff[0]?.name ?? "";
    let best = Infinity;
    for (const st of staff) {
      const load = byId.get(st.id)?.clearMinutes ?? 0;
      if (load < best) {
        best = load;
        autoName = st.name;
      }
    }
    return {
      autoSub: format(t.walkin.soonestFree, { name: autoName }),
      rows: staff.map((st) => {
        const g = byId.get(st.id);
        const sub = !g
          ? (st.roleLabel ?? t.walkin.teamMember)
          : g.waitingCount === 0
            ? t.walkin.freeNow
            : format(t.walkin.load, { waiting: g.waitingCount, load: g.clearMinutes });
        return { st, sub };
      }),
    };
  }, [seats, staff]);

  const selectedMinutes = services
    .filter((s) => serviceIds.includes(s.id))
    .reduce((n, s) => n + s.durationMinutes, 0);

  /** Toggle, not set: the sheet is a checklist. A visit can be several services. */
  function toggleService(id: string) {
    setError("");
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setError("");
    if (!name.trim()) return setError(t.walkin.errName);
    if (!serviceOptional && services.length > 0 && serviceIds.length === 0) return setError(t.walkin.errService);
    if (needsVisitorType && !visitorType) return setError(t.walkin.errVisitorType);
    setBusy(true);
    try {
      const phone = combineToE164(phoneCountry.dialCode, national) || undefined;
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Field names come from the backend's addWalkInSchema, which is .strict() — anything
        // else is rejected outright. `staffId: "auto"` is the sentinel for "soonest free seat",
        // matching what the mobile app sends. `serviceIds` supersedes the old singular
        // `serviceId`, which is why the web can now book a haircut AND a shave in one go.
        body: JSON.stringify({
          name: name.trim(),
          phone,
          serviceIds: serviceIds.length ? serviceIds : undefined,
          staffId: seatId === "any" ? "auto" : seatId,
          position,
          visitorType: visitorType ?? undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? t.walkin.errAdd);
        return;
      }
      // "Next up" skips the line, so say which of the two happened — the app's two toasts.
      showToast(position === "next" ? t.walkin.addedAsNext : t.walkin.addedToQueue, "success");
      onAdded({ position });
    } catch {
      setError(t.walkin.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet onClose={onClose} closeLabel={t.walkin.close} label={t.walkin.title} className="wk-sheet">
      <h2 className="wk-title">{t.walkin.title}</h2>

      {/* Title and footer stay put; only the form between them scrolls, as on the app. */}
      <div className="wk-scroll">
        <div className="field">
          <label htmlFor="walkin-name">{t.walkin.nameLabel}</label>
          <input
            id="walkin-name"
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
          id="walkin-phone"
          label={t.walkin.phoneLabel}
          placeholder={t.walkin.phonePlaceholder}
          value={{ dialCode: phoneCountry.dialCode, national, iso2: phoneCountry.iso2 }}
          onChange={(v) => {
            setPhoneCountry({ dialCode: v.dialCode, iso2: v.iso2 });
            setNational(v.national);
          }}
        />

        {needsVisitorType ? (
          <>
            <p className="wk-label" id="walkin-visitor">{t.walkin.visitorType}</p>
            <div className="ss-seg" role="radiogroup" aria-labelledby="walkin-visitor">
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
                    onClick={() => toggleService(s.id)}
                  >
                    <span className={`wk-service-accent wk-accent-${ACCENTS[i % ACCENTS.length]}`} aria-hidden />
                    {/* Square, deliberately: a circle would read as "pick one of these". */}
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
                    {/* Never a bare number: a range reads "₹2,000–₹6,000", an unpriced service
                        says so, exactly as the microsite and the app word it. */}
                    <span className="wk-service-price">{formatServicePrice(s)}</span>
                  </button>
                );
              })}
            </div>
            {/* A running total, because more than one service is normal now — the person at the
                counter should not have to add up the visit in their head. */}
            {serviceIds.length > 0 ? (
              <p className="wk-summary">
                {format(t.walkin.servicesSelected, { count: serviceIds.length, minutes: selectedMinutes })}
              </p>
            ) : null}
          </>
        ) : null}

        {staff.length > 0 ? (
          <>
            <p className="wk-label" id="walkin-seat">{t.walkin.assignSeat}</p>
            <div className="wk-list" role="radiogroup" aria-labelledby="walkin-seat">
              <button
                type="button"
                role="radio"
                aria-checked={seatId === "any"}
                className="wk-seat"
                onClick={() => setSeatId("any")}
              >
                <span className="wk-seat-avatar auto" aria-hidden>
                  <Icon name="sparkles" size={15} />
                </span>
                <span className="wk-seat-body">
                  <span className="wk-seat-name">{t.walkin.anySeat}</span>
                  <span className="wk-seat-sub">{seatOptions.autoSub}</span>
                </span>
                {seatId === "any" ? <Icon name="check" size={18} className="wk-seat-check" /> : null}
              </button>
              {seatOptions.rows.map(({ st, sub }) => (
                <button
                  key={st.id}
                  type="button"
                  role="radio"
                  aria-checked={seatId === st.id}
                  className="wk-seat"
                  onClick={() => setSeatId(st.id)}
                >
                  {/* The chair's own colour and ink (.seat-avatar-<token>), as on its seat board. */}
                  <span className={`wk-seat-avatar seat-avatar-${st.colorToken || "secondary"}`} aria-hidden>
                    {st.name[0]}
                  </span>
                  <span className="wk-seat-body">
                    <span className="wk-seat-name">{st.name}</span>
                    <span className="wk-seat-sub">{sub}</span>
                  </span>
                  {seatId === st.id ? <Icon name="check" size={18} className="wk-seat-check" /> : null}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <p className="wk-label" id="walkin-position">{t.walkin.addAs}</p>
        <div className="ss-seg" role="radiogroup" aria-labelledby="walkin-position">
          {(["end", "next"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={position === p}
              className="ss-seg-btn"
              onClick={() => setPosition(p)}
            >
              {p === "end" ? t.walkin.endOfQueue : t.walkin.nextUp}
            </button>
          ))}
        </div>
        <p className="wk-hint">{t.walkin.nextUpNote}</p>
      </div>

      <div className="wk-footer">
        {/* In the pinned footer rather than the scroll, so "Enter a customer name" is never
            scrolled out of sight above the button that raised it. */}
        {error ? (
          <p className="ss-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="ss-btn primary lg block" onClick={submit} disabled={busy}>
          {busy ? <Spinner size={16} /> : null}
          {busy ? t.walkin.adding : t.walkin.addToQueue}
        </button>
      </div>
    </BottomSheet>
  );
}
