"use client";

import { useRouter } from "next/navigation";
import { t, format } from "@/i18n";
import { useState, useTransition } from "react";

import { Icon } from "@/components/Icon";
import { formatServicePrice } from "@/lib/format";
import type { ServiceRow } from "@/lib/server-api";
import { Spinner } from "@/components/Skeleton";

/**
 * Service menu editor.
 *
 * Two pricing modes. A **fixed** service has one amount. A **range** service has a floor and a
 * ceiling — the customer sees the band on the microsite, and whoever checks them out types the
 * real figure, because the shop deliberately said it could not name one in advance.
 *
 * Prices go over the wire as `priceAmount` in MINOR UNITS (paise) — the backend writes it
 * straight into `price_paise`, with `priceMaxAmount` as the ceiling. The form takes rupees, so
 * it multiplies by 100 on the way out and `formatServicePrice` divides on the way back.
 *
 * The three pricing fields are always sent together: they only make sense as a set, and the
 * API refuses a half-changed price rather than leaving a fixed service holding the ceiling of
 * a range it used to be.
 *
 * `colorToken` is required by the backend's strict create schema; "secondary" is the same
 * default the mobile app and the seed use.
 */
export function ServicesEditor({ services }: { services: ServiceRow[] }) {
  const router = useRouter();
  // `router.refresh()` is async and used to be fired and forgotten, so the button stopped
  // spinning while the server was still re-rendering — the screen showed stale values and the
  // save looked like it had failed. The transition keeps `isPending` true until the fresh data
  // has actually landed.
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [mins, setMins] = useState("30");
  const [priceType, setPriceType] = useState<"fixed" | "range">("fixed");
  const [rupees, setRupees] = useState("");
  const [maxRupees, setMaxRupees] = useState("");
  const [error, setError] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isPending;

  async function send(url: string, method: string, body?: unknown) {
    setError("");
    setInFlight(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? "That didn't work.");
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError(t.services.networkError);
      return false;
    } finally {
      setInFlight(false);
    }
  }

  async function add() {
    if (!name.trim()) return setError(t.services.errName);
    // Paise, and validated before the round trip so the common mistakes name the field that is
    // wrong instead of coming back as a generic 400.
    const min = Math.round((Number(rupees) || 0) * 100);
    if (min <= 0) return setError(t.services.errPrice);
    const max = Math.round((Number(maxRupees) || 0) * 100);
    if (priceType === "range" && max < min) return setError(t.services.errPriceRange);

    const ok = await send("/api/services", "POST", {
      name: name.trim(),
      durationMinutes: Number(mins) || 30,
      priceType,
      priceAmount: min,
      // Only a range carries a ceiling — sending one on a fixed service is a 400, by design.
      ...(priceType === "range" ? { priceMaxAmount: max } : {}),
      colorToken: "secondary",
    });
    if (ok) {
      setName("");
      setRupees("");
      setMaxRupees("");
      setPriceType("fixed");
      setMins("30");
    }
  }

  return (
    <div className="section">
      <h2>{t.services.current}</h2>
      {services.length === 0 ? (
        <p className="empty">{t.services.empty}</p>
      ) : (
        <ul className="home-queue-list">
          {services.map((s) => (
            <li key={s.id} className="home-queue-card">
              <div className="title">{s.name}</div>
              <div className="meta">
                {format(t.services.minShort, { mins: s.durationMinutes })} · {formatServicePrice(s)}
              </div>
              {/* Only ever true for a service that predates pricing modes. It is called out
                  rather than shown as "₹0", because the API will now refuse to save it again
                  until a mode is chosen — and the microsite is telling customers nothing. */}
              {s.priceType === "unset" ? (
                <p className="field-hint" style={{ marginTop: 4 }}>
                  {t.services.unpricedHint}
                </p>
              ) : null}
              <button
                type="button"
                className="btn secondary btn-sm"
                style={{ marginTop: 8 }}
                disabled={busy}
                onClick={() => send(`/api/services/${s.id}`, "DELETE")}
              >
                <Icon name="trash" size={14} /> {t.services.remove}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 24 }}>{t.services.addTitle}</h2>
      <div className="field">
        <label htmlFor="sv-name">{t.services.nameLabel}</label>
        <input id="sv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.services.namePlaceholder} />
      </div>
      <div className="field">
        <label htmlFor="sv-mins">{t.services.duration}</label>
        <input id="sv-mins" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="sv-price-mode">{t.services.priceMode}</label>
        <select
          id="sv-price-mode"
          value={priceType}
          onChange={(e) => {
            setPriceType(e.target.value as "fixed" | "range");
            setError("");
          }}
        >
          <option value="fixed">{t.services.priceModeFixed}</option>
          <option value="range">{t.services.priceModeRange}</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="sv-price">{priceType === "range" ? t.services.priceMin : t.services.price}</label>
        <input
          id="sv-price"
          inputMode="numeric"
          value={rupees}
          onChange={(e) => setRupees(e.target.value)}
          placeholder="300"
        />
      </div>

      {priceType === "range" ? (
        <div className="field">
          <label htmlFor="sv-price-max">{t.services.priceMax}</label>
          <input
            id="sv-price-max"
            inputMode="numeric"
            value={maxRupees}
            onChange={(e) => setMaxRupees(e.target.value)}
            placeholder="600"
          />
          <p className="field-hint">{t.services.priceRangeHint}</p>
        </div>
      ) : null}

      {error ? (
        <div className="alert err" role="alert">
          {error}
        </div>
      ) : null}

      <button type="button" className="btn" onClick={add} disabled={busy}>
        {busy ? (
          <>
            <Spinner size={14} />
            {t.common.savingEllipsis}
          </>
        ) : (
          t.services.add
        )}
      </button>
    </div>
  );
}
