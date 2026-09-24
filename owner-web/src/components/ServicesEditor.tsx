"use client";

import { useRouter } from "next/navigation";
import { t, format } from "@/i18n";
import { useState, useTransition, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";
import { EditSheet } from "@/components/store-settings/EditSheet";
import { SbEmpty, SbField } from "@/components/store-settings/ui";
import { formatServicePrice } from "@/lib/format";
import type { ServiceRow } from "@/lib/server-api";
import { showToast } from "@/lib/toast";

/**
 * Services & pricing — the web twin of the app's settings/services.tsx + ServiceEditSheet.
 *
 * One list of the menu (a colour bar, name, duration, price and a pencil). Clicking a row opens
 * the edit sheet; "Add service" opens the same sheet empty. Before the port the web could only
 * add and delete — an owner who mistyped a price had to delete the service and add it again,
 * which also dropped its colour and its place in the menu. PATCH /services/:id was always there.
 *
 * Two pricing modes. A **fixed** service has one amount. A **range** service has a floor and a
 * ceiling — the customer sees the band on the microsite, and whoever checks them out types the
 * real figure, because the shop deliberately said it could not name one in advance.
 *
 * Prices go over the wire in MINOR UNITS (paise): the form takes rupees and multiplies by 100,
 * `formatServicePrice` divides on the way back. Mode, amount and (for a range only) the ceiling
 * always travel together — the API refuses a half-changed price rather than leaving a fixed
 * service holding the ceiling of a range it used to be.
 *
 * A new service gets its colour and position the way the app assigns them (the palette cycled by
 * list length, appended at the end), so a service added on the laptop looks the same on the phone.
 */

const COLOR_PALETTE = ["primary", "secondary", "amber500", "green500"] as const;
const TONES = new Set<string>(COLOR_PALETTE);

/** What the sheet hands back. Rupees — converted to paise at the call site. */
interface ServiceFormValues {
  name: string;
  durationMinutes: number;
  priceType: "fixed" | "range";
  /** The fixed price, or the range floor. */
  priceRupees: number;
  /** The range ceiling; null for a fixed price. */
  priceMaxRupees: number | null;
}

export function ServicesEditor({ services }: { services: ServiceRow[] }) {
  const router = useRouter();
  // The refresh is a transition so the list re-renders from fresh server data rather than the
  // stale props, without a manual loading state.
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [open, setOpen] = useState(false);
  // Bumped per opening: the form is keyed on it, so its fields seed from props on every open (the
  // app remounts its form by key for the same reason) instead of syncing state in an effect.
  const [openCount, setOpenCount] = useState(0);
  const [busy, setBusy] = useState(false);

  function openSheet(service: ServiceRow | null) {
    setEditing(service);
    setOpenCount((n) => n + 1);
    setOpen(true);
  }

  /**
   * One mutation. Outcomes are toasts, as in the app, and a failure keeps the sheet open so the
   * owner can read the message and fix the field instead of retyping the whole service.
   */
  async function send(url: string, method: string, body: unknown, ok: string, fail: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        showToast(json?.error?.message ?? fail, "error");
        return false;
      }
      showToast(ok, "success");
      setOpen(false);
      startTransition(() => router.refresh());
      return true;
    } catch {
      showToast(t.services.networkError, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onSave(f: ServiceFormValues) {
    const pricing = {
      priceType: f.priceType,
      priceAmount: Math.round(f.priceRupees * 100),
      // Only a range carries a ceiling — sending one on a fixed service is a 400, by design.
      ...(f.priceType === "range" && f.priceMaxRupees != null
        ? { priceMaxAmount: Math.round(f.priceMaxRupees * 100) }
        : {}),
    };
    if (editing) {
      void send(
        `/api/services/${editing.id}`,
        "PATCH",
        { name: f.name, durationMinutes: f.durationMinutes, ...pricing },
        t.services.toastUpdated,
        t.services.errUpdate,
      );
      return;
    }
    void send(
      "/api/services",
      "POST",
      {
        name: f.name,
        durationMinutes: f.durationMinutes,
        ...pricing,
        colorToken: COLOR_PALETTE[services.length % COLOR_PALETTE.length],
        position: services.length,
      },
      t.services.toastAdded,
      t.services.errAdd,
    );
  }

  function onRemove() {
    if (!editing) return;
    // Soft delete on the backend, so visits already recorded keep their service.
    void send(`/api/services/${editing.id}`, "DELETE", undefined, t.services.toastRemoved, t.services.errRemove);
  }

  return (
    <>
      {/* Empty: a centred message in place of an empty bordered card, with Add right below it. */}
      {services.length === 0 ? (
        <SbEmpty icon="scissors" title={t.services.empty} />
      ) : (
        <ul className="sb-list">
          {services.map((s) => {
            const tone = s.colorToken && TONES.has(s.colorToken) ? s.colorToken : "secondary";
            return (
              <li key={s.id} className="sb-list-item">
                <button
                  type="button"
                  className="sb-item"
                  onClick={() => openSheet(s)}
                  // A tooltip, not an aria-label: the row's own text (name, duration, price) is the
                  // better accessible name, and an aria-label would replace it.
                  title={format(t.services.editAria, { name: s.name })}
                >
                  <span className={`sb-accent sb-tone-${tone}`} aria-hidden />
                  <span className="sb-item-body">
                    <span className="sb-item-name">{s.name}</span>
                    <span className="sb-item-sub">{format(t.services.minShort, { mins: s.durationMinutes })}</span>
                  </span>
                  <span className="sb-item-price">{formatServicePrice(s)}</span>
                  <Icon name="edit" size={16} className="sb-item-icon" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="sb-btn sb-btn--outline sb-btn--block sb-add" onClick={() => openSheet(null)}>
        <Icon name="plus" size={18} />
        {t.services.add}
      </button>

      <EditSheet
        open={open}
        title={editing ? t.services.editTitle : t.services.addTitle}
        locked={busy}
        onClose={() => setOpen(false)}
      >
        {open ? (
          <ServiceForm key={openCount} service={editing} busy={busy} onSave={onSave} onRemove={onRemove} />
        ) : null}
      </EditSheet>
    </>
  );
}

function rupees(paise: number | undefined | null): string {
  return paise == null ? "" : String(paise / 100);
}

/** Remounted per opening (via key) so its fields seed from props without effects. */
function ServiceForm({
  service,
  busy,
  onSave,
  onRemove,
}: {
  service: ServiceRow | null;
  busy: boolean;
  onSave: (f: ServiceFormValues) => void;
  onRemove: () => void;
}) {
  // A service saved before pricing modes existed arrives as `unset` — no price at all. It opens on
  // Fixed with an EMPTY box: the zero it carries in the database is a legacy marker, not an
  // amount to seed the field with, and the API will not take it back until a real one is chosen.
  const legacyUnpriced = service?.priceType === "unset";
  const [name, setName] = useState(service?.name ?? "");
  const [duration, setDuration] = useState(service ? String(service.durationMinutes) : "");
  const [priceType, setPriceType] = useState<"fixed" | "range">(service?.priceType === "range" ? "range" : "fixed");
  const [price, setPrice] = useState(service && !legacyUnpriced ? rupees(service.price?.amount) : "");
  const [maxPrice, setMaxPrice] = useState(rupees(service?.priceMax?.amount));
  const [error, setError] = useState("");

  const edit = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setError("");
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    const durationMinutes = parseInt(duration, 10);
    const priceRupees = parseFloat(price);
    // One message for the three required fields, as in the app — validated before the round
    // trip so a typo never comes back as a generic 400.
    if (!name.trim() || !durationMinutes || durationMinutes < 1 || !priceRupees || priceRupees <= 0) {
      setError(t.services.errFields);
      return;
    }
    if (priceType === "range") {
      const priceMaxRupees = parseFloat(maxPrice);
      if (!priceMaxRupees || priceMaxRupees <= 0) {
        setError(t.services.errFields);
        return;
      }
      if (priceMaxRupees < priceRupees) {
        setError(t.services.errPriceRange);
        return;
      }
      onSave({ name: name.trim(), durationMinutes, priceType, priceRupees, priceMaxRupees });
      return;
    }
    onSave({ name: name.trim(), durationMinutes, priceType, priceRupees, priceMaxRupees: null });
  }

  return (
    <form className="sb-form" onSubmit={submit} noValidate>
      <SbField id="sv-name" label={t.services.nameLabel}>
        <input
          id="sv-name"
          value={name}
          onChange={(e) => edit(setName)(e.target.value)}
          placeholder={t.services.namePlaceholder}
          // Not `autoFocus` — EditSheet focuses this after noting who opened it (see there).
          data-autofocus={service ? undefined : true}
          maxLength={80}
        />
      </SbField>
      {legacyUnpriced ? <p className="sb-field-hint">{t.services.unpricedHint}</p> : null}

      {/* Segmented, not a <select>: there are exactly two modes and the choice changes which
          fields are below it, so it has to be visible rather than one click away. */}
      <div className="sb-form-group">
        <p className="sb-caption" id="sv-mode-label">
          {t.services.priceMode}
        </p>
        <div className="sb-seg" role="radiogroup" aria-labelledby="sv-mode-label">
          {(["fixed", "range"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={priceType === mode}
              className={`sb-btn ${priceType === mode ? "sb-btn--primary" : "sb-btn--outline"}`}
              onClick={() => {
                setPriceType(mode);
                setError("");
              }}
            >
              {mode === "fixed" ? t.services.priceModeFixed : t.services.priceModeRange}
            </button>
          ))}
        </div>
      </div>

      <div className="sb-row2">
        <SbField id="sv-mins" label={t.services.duration}>
          <input
            id="sv-mins"
            inputMode="numeric"
            value={duration}
            onChange={(e) => edit(setDuration)(e.target.value)}
            placeholder={t.services.durationPlaceholder}
          />
        </SbField>
        <SbField
          id="sv-price"
          label={priceType === "range" ? t.services.priceMin : t.services.price}
          prefix={t.services.pricePrefix}
        >
          <input
            id="sv-price"
            inputMode="decimal"
            value={price}
            onChange={(e) => edit(setPrice)(e.target.value)}
            placeholder={t.services.pricePlaceholder}
          />
        </SbField>
      </div>

      {priceType === "range" ? (
        <>
          <SbField id="sv-price-max" label={t.services.priceMax} prefix={t.services.pricePrefix}>
            <input
              id="sv-price-max"
              inputMode="decimal"
              value={maxPrice}
              onChange={(e) => edit(setMaxPrice)(e.target.value)}
              placeholder={t.services.priceMaxPlaceholder}
            />
          </SbField>
          <p className="sb-field-hint">{t.services.priceRangeHint}</p>
        </>
      ) : null}

      {error ? (
        <p className="sb-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="sb-btn sb-btn--primary sb-btn--lg sb-btn--block" disabled={busy}>
        {busy ? <Spinner size={16} /> : null}
        {t.services.save}
      </button>
      {service ? (
        <button
          type="button"
          className="sb-btn sb-btn--ghost sb-btn--danger sb-btn--block"
          disabled={busy}
          onClick={onRemove}
        >
          {t.services.remove}
        </button>
      ) : null}
    </form>
  );
}
