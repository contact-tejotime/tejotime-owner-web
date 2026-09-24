"use client";

import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { useState, useTransition } from "react";

import { Spinner } from "@/components/Skeleton";
import { StoreBookingQr } from "@/components/StoreBookingQr";
import { Icon } from "@/components/Icon";
import { SbField, SbSection } from "@/components/store-settings/ui";
import { showToast } from "@/lib/toast";

/**
 * Business name and address — the profile form a STAFF login with `profile: manage` gets. The web
 * twin of the app's StaffProfileForm: Basics (name, the phone read-only, address), then the store's
 * Booking QR, then Save changes.
 *
 * Scoped to exactly the two fields the backend lets a non-owner write (`PATCH /business` with
 * `{ name?, address? }` — BASE_COLUMNS in the business service). The public shopfront fields stay
 * owner-only, on StoreProfileEditor.
 */
export function BusinessProfileForm({
  name,
  address,
  countryCode = null,
  phoneNumber = null,
  cardUrl = null,
}: {
  name: string;
  address: string;
  /** Shown read-only, as in the app — the number is the sign-in and the page's address. */
  countryCode?: string | null;
  phoneNumber?: string | null;
  /** The booking chooser URL from GET /business/qr; the QR row is hidden without it. */
  cardUrl?: string | null;
}) {
  const router = useRouter();
  // `router.refresh()` is async and used to be fired and forgotten, so the button stopped
  // spinning while the server was still re-rendering — the screen showed stale values and the
  // save looked like it had failed. The transition keeps `isPending` true until the fresh data
  // has actually landed.
  const [isPending, startTransition] = useTransition();
  const [n, setN] = useState(name);
  const [a, setA] = useState(address);
  const [error, setError] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isPending;

  const dirty = n !== name || a !== address;

  async function save() {
    // The app refuses a blank name before the request; so does this.
    if (!n.trim()) return;
    setError("");
    setInFlight(true);
    try {
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n.trim(), address: a.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error?.message ?? t.businessForm.errSave);
        return;
      }
      showToast(t.businessForm.saved, "success");
      startTransition(() => router.refresh());
    } catch {
      setError(t.businessForm.networkError);
    } finally {
      setInFlight(false);
    }
  }

  return (
    <>
      <SbSection title={t.businessForm.title}>
        <SbField id="bp-name" label={t.businessForm.name}>
          <input id="bp-name" value={n} onChange={(e) => setN(e.target.value)} />
        </SbField>
        <SbField id="bp-phone" label={t.businessForm.phone} prefix={countryCode ? `+${countryCode}` : undefined} disabled>
          <input id="bp-phone" value={phoneNumber ?? ""} readOnly aria-readonly="true" />
        </SbField>
        <SbField id="bp-addr" label={t.businessForm.address}>
          <input id="bp-addr" value={a} onChange={(e) => setA(e.target.value)} />
        </SbField>
      </SbSection>

      {cardUrl ? (
        <section className="sb-section">
          <h2 className="sb-section-title">{t.profile.contactQr}</h2>
          <div className="sb-srow-card">
            <div className="sb-srow">
              <span className="sb-srow-icon" aria-hidden>
                <Icon name="qrCode" size={18} />
              </span>
              <span className="sb-srow-body">
                <span className="sb-srow-text">
                  <span className="sb-srow-label">{t.profile.contactQr}</span>
                  <span className="sb-srow-sub">{t.profile.contactSub}</span>
                </span>
                <Icon name="chevronRight" size={18} className="sb-srow-chev" />
              </span>
              {/* The shared QR dialog, its trigger stretched over the whole row. */}
              <StoreBookingQr cardUrl={cardUrl} storeName={n || name} buttonClassName="sb-srow-cover" />
            </div>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="sb-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sb-savebar">
        <div className="sb-savebar-btns">
          <button
            type="button"
            className="sb-btn sb-btn--primary sb-btn--lg sb-btn--block"
            onClick={save}
            disabled={busy || !dirty || !n.trim()}
          >
            {busy ? <Spinner size={16} /> : null}
            {busy ? t.common.savingEllipsis : t.businessForm.save}
          </button>
        </div>
      </div>
    </>
  );
}
