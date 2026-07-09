"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DAY_LABELS,
  EMPTY_FORM,
  toPayload,
  type Category,
  type FaqRow,
  type ReviewRow,
  type ServiceRow,
  type StaffRow,
  type StoreForm as StoreFormState,
  type StoreMutationResult,
} from "@/lib/types";
import { CURRENCIES, CURRENCY_BY_CODE, currencySymbol } from "@/lib/currencies";
import { GalleryUpload, ImageUpload } from "@/components/ImageUpload";

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL ?? "https://www.tejotime.com";

type ErrorDetail = { field?: string; message: string };

interface Props {
  mode: "create" | "edit";
  categories: Category[];
  initial?: StoreFormState;
  storeId?: string;
  /** Rendered inside the store hub (which owns the page wrapper and heading). */
  embedded?: boolean;
}

export default function StoreForm({ mode, categories, initial, storeId, embedded = false }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<StoreFormState>(initial ?? EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<ErrorDetail[]>([]);
  const [result, setResult] = useState<StoreMutationResult | null>(null);

  const set = <K extends keyof StoreFormState>(key: K, value: StoreFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const phoneFull = `${form.countryCode.replace(/\D/g, "")}${form.phoneNumber.replace(/\D/g, "")}`;

  const setService = (i: number, patch: Partial<ServiceRow>) =>
    setForm((f) => ({ ...f, services: f.services.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  const setStaff = (i: number, patch: Partial<StaffRow>) =>
    setForm((f) => ({ ...f, staff: f.staff.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  const setFaq = (i: number, patch: Partial<FaqRow>) =>
    setForm((f) => ({ ...f, faqs: f.faqs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) }));
  const setReview = (i: number, patch: Partial<ReviewRow>) =>
    setForm((f) => ({ ...f, reviews: f.reviews.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) }));
  const setAmenity = (i: number, value: string) =>
    setForm((f) => ({ ...f, amenities: f.amenities.map((a, idx) => (idx === i ? value : a)) }));
  const setHour = (i: number, patch: Partial<StoreFormState["hours"][number]>) =>
    setForm((f) => ({ ...f, hours: f.hours.map((h, idx) => (idx === i ? { ...h, ...patch } : h)) }));

  const removeAt = <T,>(arr: T[], i: number) => arr.filter((_, idx) => idx !== i);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setDetails([]);
    setResult(null);

    // Required business fields — blocked here for a friendly message (native `required` also guards).
    const requiredFields: { key: keyof StoreFormState; label: string }[] = [
      { key: "category", label: "Category" },
      { key: "area", label: "Area" },
      { key: "city", label: "City" },
      { key: "address", label: "Address" },
      { key: "tagline", label: "Tagline" },
      { key: "aboutHeading", label: "About heading" },
      { key: "description", label: "Description" },
    ];
    const missing = requiredFields.filter((f) => !String(form[f.key] ?? "").trim());
    if (missing.length > 0) {
      setError("Please fill all required fields.");
      setDetails(missing.map((f) => ({ field: f.label, message: "This field is required." })));
      setSaving(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    try {
      const url = mode === "create" ? "/api/create-store" : `/api/stores/${storeId}`;
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toPayload(form, mode === "create")),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? `Request failed (${res.status})`);
        setDetails(json?.error?.details ?? []);
        return;
      }
      setResult(json as StoreMutationResult);
      router.refresh(); // update the sidebar list (new/renamed store)
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const previewUrl = useMemo(() => (result ? `${FRONTEND_URL}${result.micrositePath}` : ""), [result]);

  // Categories may not include the store's current value (e.g. a deactivated category on edit);
  // keep it selectable so a save doesn't silently drop it.
  const categoryOptions = useMemo(() => {
    const names = categories.map((c) => c.name);
    return form.category && !names.includes(form.category) ? [form.category, ...names] : names;
  }, [categories, form.category]);

  // Same trick for currency: an off-list legacy code stays selectable rather than being dropped.
  const currencyOptions = useMemo(() => {
    return form.currency && !CURRENCY_BY_CODE[form.currency]
      ? [{ code: form.currency, symbol: form.currency, name: form.currency }, ...CURRENCIES]
      : CURRENCIES;
  }, [form.currency]);

  return (
    <div className={embedded ? undefined : "wrap"}>
      {!embedded && (
        <div className="page-head">
          <h1>{mode === "create" ? "Create a store" : `Edit — ${form.name || "store"}`}</h1>
        </div>
      )}

      {error && (
        <div className="alert err">
          {error}
          {details.length > 0 && (
            <ul>
              {details.map((d, i) => (
                <li key={i}>
                  {d.field ? <strong>{d.field}: </strong> : null}
                  {d.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <div className="alert ok">
          <div>
            ✓ {mode === "create" ? "Store created" : "Changes saved"}. Live at{" "}
            <a href={previewUrl} target="_blank" rel="noreferrer">
              {previewUrl}
            </a>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit}>
        {/* Store status (edit only — new stores always start active) ------ */}
        {mode === "edit" && (
          <section className="section">
            <h2>
              Store status{" "}
              <span className={`badge ${form.isActive ? "badge-active" : "badge-inactive"}`}>
                {form.isActive ? "Active" : "Inactive"}
              </span>
            </h2>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => set("isActive", e.target.checked)}
              />
              Store is active
            </label>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
              When inactive, the public microsite, online booking and queue joining return 404. The store stays
              visible in this admin panel. Remember to save for the change to take effect.
            </p>
          </section>
        )}

        {/* Business ------------------------------------------------------ */}
        <section className="section">
          <h2>Business details</h2>
          <div className="grid">
            <div className="field">
              <label>Store name *</label>
              <input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} />
            </div>
            <div className="field">
              <label>Category *</label>
              <select value={form.category} onChange={(e) => set("category", e.target.value)} required>
                <option value="">— Select category —</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Currency *</label>
              <select value={form.currency} onChange={(e) => set("currency", e.target.value)} required>
                {currencyOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {`${c.symbol} — ${c.name} (${c.code})`}
                  </option>
                ))}
              </select>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                Used for all prices on this store. Changing it does not convert existing prices.
              </p>
            </div>
            <div className="field">
              <label>Area *</label>
              <input value={form.area} onChange={(e) => set("area", e.target.value)} required maxLength={120} />
            </div>
            <div className="field">
              <label>City *</label>
              <input value={form.city} onChange={(e) => set("city", e.target.value)} required maxLength={80} />
            </div>
            <div className="field full">
              <label>Address *</label>
              <input value={form.address} onChange={(e) => set("address", e.target.value)} required maxLength={300} />
            </div>
            <div className="field full">
              <label>Tagline *</label>
              <input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} required maxLength={160} />
            </div>
            <div className="field full">
              <label>Banner subtitle</label>
              <input
                value={form.heroSubtitle}
                onChange={(e) => set("heroSubtitle", e.target.value)}
                maxLength={200}
                placeholder="e.g. track your turn from your phone"
              />
            </div>
            <div className="field">
              <label>Highlight number</label>
              <input value={form.statValue} onChange={(e) => set("statValue", e.target.value)} maxLength={40} placeholder="e.g. 30k+" />
            </div>
            <div className="field">
              <label>Highlight caption</label>
              <input value={form.statLabel} onChange={(e) => set("statLabel", e.target.value)} maxLength={60} placeholder="e.g. haircuts done" />
            </div>
            <div className="field full">
              <label>About heading *</label>
              <input
                value={form.aboutHeading}
                onChange={(e) => set("aboutHeading", e.target.value)}
                required
                maxLength={160}
              />
            </div>
            <div className="field full">
              <label>Description *</label>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} required maxLength={2000} />
            </div>
          </div>
          <div className="grid cols-3" style={{ marginTop: 12 }}>
            <div className="field">
              <label>Established year</label>
              <input value={form.establishedYear} onChange={(e) => set("establishedYear", e.target.value)} inputMode="numeric" />
            </div>
            <div className="field">
              <label>Rating (0–5)</label>
              <input value={form.rating} onChange={(e) => set("rating", e.target.value)} inputMode="decimal" />
            </div>
            <div className="field">
              <label>Review count</label>
              <input value={form.reviewCount} onChange={(e) => set("reviewCount", e.target.value)} inputMode="numeric" />
            </div>
            <div className="field full">
              <label>Payments (comma-separated)</label>
              <input value={form.payments} onChange={(e) => set("payments", e.target.value)} />
            </div>
          </div>
        </section>

        {/* Contact / phone ---------------------------------------------- */}
        <section className="section">
          <h2>Website address (phone)</h2>
          <div className="grid cols-3">
            <div className="field">
              <label>Country code *</label>
              <input value={form.countryCode} onChange={(e) => set("countryCode", e.target.value)} inputMode="numeric" required />
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Phone number *</label>
              <input value={form.phoneNumber} onChange={(e) => set("phoneNumber", e.target.value)} inputMode="numeric" required />
            </div>
          </div>
          <p className="hint">
            Live at <code>{FRONTEND_URL}/{phoneFull || "…"}</code>
          </p>
        </section>

        {/* Hours -------------------------------------------------------- */}
        <section className="section">
          <h2>Weekly hours</h2>
          {form.hours.map((h, i) => (
            <div className="hours-row" key={h.dayOfWeek}>
              <span className="day">{DAY_LABELS[h.dayOfWeek]}</span>
              <input
                type="time"
                value={h.opensAt}
                disabled={h.isClosed}
                onChange={(e) => setHour(i, { opensAt: e.target.value })}
                aria-label={`${DAY_LABELS[h.dayOfWeek]} opens at`}
              />
              <input
                type="time"
                value={h.closesAt}
                disabled={h.isClosed}
                onChange={(e) => setHour(i, { closesAt: e.target.value })}
                aria-label={`${DAY_LABELS[h.dayOfWeek]} closes at`}
              />
              <label className="closed">
                <input type="checkbox" checked={h.isClosed} onChange={(e) => setHour(i, { isClosed: e.target.checked })} />
                Closed
              </label>
            </div>
          ))}
        </section>

        {/* Amenities ---------------------------------------------------- */}
        <section className="section">
          <h2>Amenities</h2>
          {form.amenities.map((a, i) => (
            <div className="row amenity" key={i}>
              <input value={a} onChange={(e) => setAmenity(i, e.target.value)} placeholder="e.g. Air conditioned" />
              <button type="button" className="btn-remove" onClick={() => set("amenities", removeAt(form.amenities, i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn-add" onClick={() => set("amenities", [...form.amenities, ""])}>
            + Add amenity
          </button>
        </section>

        {/* Photos (hero + about) --------------------------------------- */}
        <section className="section">
          <h2>Photos</h2>
          <ImageUpload
            label="Banner photo"
            assetType="hero"
            value={form.heroImageUrl}
            onChange={(url) => set("heroImageUrl", url)}
          />
          <ImageUpload
            label="About photo"
            assetType="about"
            value={form.aboutImageUrl}
            onChange={(url) => set("aboutImageUrl", url)}
          />
        </section>

        {/* Gallery ------------------------------------------------------ */}
        <section className="section">
          <h2>Gallery photos</h2>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Upload from your device. Many photos horizontally scroll on the live site.
          </p>
          <GalleryUpload assetType="gallery" value={form.gallery} onChange={(rows) => set("gallery", rows)} />
        </section>

        {/* Services ----------------------------------------------------- */}
        <section className="section">
          <h2>Services *</h2>
          {form.services.map((s, i) => (
            <div className="row service" key={i}>
              <div className="field">
                <label>Name</label>
                <input value={s.name} onChange={(e) => setService(i, { name: e.target.value })} />
              </div>
              <div className="field">
                <label>Duration (min)</label>
                <input value={s.durationMinutes} onChange={(e) => setService(i, { durationMinutes: Number(e.target.value) })} inputMode="numeric" />
              </div>
              <div className="field">
                <label>Price ({currencySymbol(form.currency)})</label>
                <input value={s.priceRupees} onChange={(e) => setService(i, { priceRupees: Number(e.target.value) })} inputMode="numeric" />
              </div>
              <button type="button" className="btn-remove" onClick={() => set("services", removeAt(form.services, i))}>
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-add"
            onClick={() => set("services", [...form.services, { name: "", durationMinutes: 30, priceRupees: 0 }])}
          >
            + Add service
          </button>
        </section>

        {/* Staff -------------------------------------------------------- */}
        <section className="section">
          <h2>Staff *</h2>
          {form.staff.map((s, i) => (
            <div className="row staff" key={i}>
              <div className="field">
                <label>Name</label>
                <input value={s.name} onChange={(e) => setStaff(i, { name: e.target.value })} />
              </div>
              <div className="field">
                <label>Role</label>
                <input value={s.roleLabel} onChange={(e) => setStaff(i, { roleLabel: e.target.value })} placeholder="e.g. Master barber" />
              </div>
              <button type="button" className="btn-remove" onClick={() => set("staff", removeAt(form.staff, i))}>
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-add"
            onClick={() => set("staff", [...form.staff, { name: "", roleLabel: "" }])}
          >
            + Add staff
          </button>
        </section>

        {/* Good to know (FAQ) ------------------------------------------- */}
        <section className="section">
          <h2>Good to know (Q&amp;A)</h2>
          {form.faqs.length === 0 && <p className="hint">Optional — questions &amp; answers shown in the microsite&apos;s “Good to know” section.</p>}
          {form.faqs.map((x, i) => (
            <div className="row faq" key={i}>
              <div className="field">
                <label>Question</label>
                <input value={x.q} onChange={(e) => setFaq(i, { q: e.target.value })} placeholder="Do I need an appointment?" />
              </div>
              <div className="field">
                <label>Answer</label>
                <input value={x.a} onChange={(e) => setFaq(i, { a: e.target.value })} placeholder="No — walk in any time…" />
              </div>
              <button type="button" className="btn-remove" onClick={() => set("faqs", removeAt(form.faqs, i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn-add" onClick={() => set("faqs", [...form.faqs, { q: "", a: "" }])}>
            + Add Q&amp;A
          </button>
        </section>

        {/* Customer reviews -------------------------------------------- */}
        <section className="section">
          <h2>Customer reviews</h2>
          {form.reviews.length === 0 && <p className="hint">Optional — shown in the microsite&apos;s “What customers say” section.</p>}
          {form.reviews.map((r, i) => (
            <div className="row review" key={i}>
              <div className="field">
                <label>Rating</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setReview(i, { stars: n })}
                      aria-label={`${n} star${n > 1 ? "s" : ""}`}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 22, lineHeight: 1, color: n <= r.stars ? "#f5a623" : "#cbd5e1" }}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Review</label>
                <input value={r.text} onChange={(e) => setReview(i, { text: e.target.value })} maxLength={1000} placeholder="Great service, quick and friendly…" />
              </div>
              <div className="field">
                <label>Name</label>
                <input value={r.authorName} onChange={(e) => setReview(i, { authorName: e.target.value })} maxLength={120} placeholder="e.g. Aman R." />
              </div>
              <button type="button" className="btn-remove" onClick={() => set("reviews", removeAt(form.reviews, i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn-add" onClick={() => set("reviews", [...form.reviews, { stars: 5, text: "", authorName: "" }])}>
            + Add review
          </button>
        </section>

        {/* Owner login (create only) ------------------------------------ */}
        {mode === "create" && (
          <section className="section">
            <h2>Owner login</h2>
            <div className="grid">
              <div className="field">
                <label>Owner phone (login)</label>
                <input value={phoneFull} readOnly />
                <p className="hint">Uses the store phone above.</p>
              </div>
              <div className="field">
                <label>Password *</label>
                <input type="text" value={form.ownerPassword} onChange={(e) => set("ownerPassword", e.target.value)} minLength={6} required />
              </div>
            </div>
          </section>
        )}

        <div className="actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Save & create store" : "Save changes"}
          </button>
          {saving && <span className="hint">Working…</span>}
        </div>
      </form>
    </div>
  );
}

