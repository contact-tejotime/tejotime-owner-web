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
import { countryByDial, DEFAULT_ISO2 } from "@/lib/phone";
import { t, format } from "@/i18n";
import { Icon } from "@/components/icons";
import { GalleryUpload, ImageUpload } from "@/components/ImageUpload";
import PhoneField from "@/components/ui/PhoneField";
import Spinner from "@/components/ui/Spinner";

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
  // The picker tracks the selected country (for flag/validation); the stored value
  // stays split across form.countryCode (dial code) + form.phoneNumber (national).
  const [phoneIso2, setPhoneIso2] = useState(() => countryByDial(form.countryCode)?.iso2 ?? DEFAULT_ISO2);

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
    if (saving) return; // hard-block duplicate submits (belt-and-suspenders with the disabled button)
    setSaving(true);
    setError(null);
    setDetails([]);
    setResult(null);

    // Required business fields — blocked here for a friendly message (native `required` also guards).
    const requiredFields: { key: keyof StoreFormState; label: string }[] = [
      { key: "category", label: t.storeForm.reqCategory },
      { key: "area", label: t.storeForm.reqArea },
      { key: "city", label: t.storeForm.reqCity },
      { key: "address", label: t.storeForm.reqAddress },
      { key: "tagline", label: t.storeForm.reqTagline },
      { key: "aboutHeading", label: t.storeForm.reqAboutHeading },
      { key: "description", label: t.storeForm.reqDescription },
    ];
    const missing = requiredFields.filter((f) => !String(form[f.key] ?? "").trim());
    if (missing.length > 0) {
      setError(t.storeForm.fillRequired);
      setDetails(missing.map((f) => ({ field: f.label, message: t.storeForm.fieldRequired })));
      setSaving(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    try {
      const url = mode === "create" ? "/api/create-store" : `/api/stores/${storeId}`;
      const method = mode === "create" ? "POST" : "PUT";
      const payload = toPayload(form, mode === "create");
      // Enable/disable lives on the store-hub header toggle now; omit isActive on
      // edit so saving this form can never clobber it (backend keeps the current
      // value when the field is absent).
      if (mode === "edit") delete payload.isActive;
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? format(t.storeForm.requestFailed, { status: res.status }));
        setDetails(json?.error?.details ?? []);
        return;
      }
      setResult(json as StoreMutationResult);
      router.refresh(); // update the sidebar list (new/renamed store)
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.storeForm.somethingWrong);
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
          <h1>{mode === "create" ? t.storeForm.createTitle : format(t.storeForm.editTitle, { name: form.name || t.storeForm.storeFallback })}</h1>
        </div>
      )}

      {error && (
        <div className="alert err" role="alert">
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
        <div className="alert ok" role="status">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="checkCircle" size={17} style={{ flexShrink: 0 }} />
            <span>
              {mode === "create" ? t.storeForm.createdOk : t.storeForm.savedOk}. {t.storeForm.liveAt}{" "}
              <a href={previewUrl} target="_blank" rel="noreferrer">
                {previewUrl}
              </a>
            </span>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit}>
        {/* Business ------------------------------------------------------ */}
        <section className="section">
          <h2>{t.storeForm.businessDetails}</h2>
          <div className="grid">
            <div className="field">
              <label htmlFor="sf-name">{t.storeForm.storeName}</label>
              <input id="sf-name" value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="sf-category">{t.storeForm.category}</label>
              <select id="sf-category" value={form.category} onChange={(e) => set("category", e.target.value)} required>
                <option value="">{t.storeForm.selectCategory}</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sf-currency">{t.storeForm.currency}</label>
              <select id="sf-currency" value={form.currency} onChange={(e) => set("currency", e.target.value)} required>
                {currencyOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {`${c.symbol} — ${c.name} (${c.code})`}
                  </option>
                ))}
              </select>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                {t.storeForm.currencyHint}
              </p>
            </div>
            <div className="field">
              <label htmlFor="sf-area">{t.storeForm.area}</label>
              <input id="sf-area" value={form.area} onChange={(e) => set("area", e.target.value)} required maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="sf-city">{t.storeForm.city}</label>
              <input id="sf-city" value={form.city} onChange={(e) => set("city", e.target.value)} required maxLength={80} />
            </div>
            <div className="field full">
              <label htmlFor="sf-address">{t.storeForm.address}</label>
              <input id="sf-address" value={form.address} onChange={(e) => set("address", e.target.value)} required maxLength={300} />
            </div>
            <div className="field full">
              <label htmlFor="sf-tagline">{t.storeForm.tagline}</label>
              <input id="sf-tagline" value={form.tagline} onChange={(e) => set("tagline", e.target.value)} required maxLength={160} />
            </div>
            <div className="field full">
              <label htmlFor="sf-heroSubtitle">{t.storeForm.bannerSubtitle}</label>
              <input
                id="sf-heroSubtitle"
                value={form.heroSubtitle}
                onChange={(e) => set("heroSubtitle", e.target.value)}
                maxLength={200}
                placeholder={t.storeForm.bannerSubtitlePlaceholder}
              />
            </div>
            <div className="field">
              <label htmlFor="sf-statValue">{t.storeForm.highlightNumber}</label>
              <input id="sf-statValue" value={form.statValue} onChange={(e) => set("statValue", e.target.value)} maxLength={40} placeholder={t.storeForm.highlightNumberPlaceholder} />
            </div>
            <div className="field">
              <label htmlFor="sf-statLabel">{t.storeForm.highlightCaption}</label>
              <input id="sf-statLabel" value={form.statLabel} onChange={(e) => set("statLabel", e.target.value)} maxLength={60} placeholder={t.storeForm.highlightCaptionPlaceholder} />
            </div>
            <div className="field full">
              <label htmlFor="sf-aboutHeading">{t.storeForm.aboutHeading}</label>
              <input
                id="sf-aboutHeading"
                value={form.aboutHeading}
                onChange={(e) => set("aboutHeading", e.target.value)}
                required
                maxLength={160}
              />
            </div>
            <div className="field full">
              <label htmlFor="sf-description">{t.storeForm.description}</label>
              <textarea id="sf-description" value={form.description} onChange={(e) => set("description", e.target.value)} required maxLength={2000} />
            </div>
          </div>
          <div className="grid cols-3" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="sf-establishedYear">{t.storeForm.establishedYear}</label>
              <input id="sf-establishedYear" value={form.establishedYear} onChange={(e) => set("establishedYear", e.target.value)} inputMode="numeric" />
            </div>
            <div className="field">
              <label htmlFor="sf-rating">{t.storeForm.rating}</label>
              <input id="sf-rating" value={form.rating} onChange={(e) => set("rating", e.target.value)} inputMode="decimal" />
            </div>
            <div className="field">
              <label htmlFor="sf-reviewCount">{t.storeForm.reviewCount}</label>
              <input id="sf-reviewCount" value={form.reviewCount} onChange={(e) => set("reviewCount", e.target.value)} inputMode="numeric" />
            </div>
            <div className="field full">
              <label htmlFor="sf-payments">{t.storeForm.payments}</label>
              <input id="sf-payments" value={form.payments} onChange={(e) => set("payments", e.target.value)} />
            </div>
          </div>
        </section>

        {/* Contact / phone ---------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.phoneSection}</h2>
          <PhoneField
            id="store-phone"
            label={t.storeForm.phoneLabel}
            required
            value={{ dialCode: form.countryCode, national: form.phoneNumber, iso2: phoneIso2 }}
            onChange={(v) => {
              set("countryCode", v.dialCode);
              set("phoneNumber", v.national);
              setPhoneIso2(v.iso2);
            }}
          />
          <p className="hint">
            {t.storeForm.liveUrl} <code>{FRONTEND_URL}/{phoneFull || "…"}</code>
          </p>
        </section>

        {/* Hours -------------------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.weeklyHours}</h2>
          {form.hours.map((h, i) => (
            <div className="hours-row" key={h.dayOfWeek}>
              <span className="day">{DAY_LABELS[h.dayOfWeek]}</span>
              <input
                type="time"
                value={h.opensAt}
                disabled={h.isClosed}
                onChange={(e) => setHour(i, { opensAt: e.target.value })}
                aria-label={format(t.storeForm.opensAt, { day: DAY_LABELS[h.dayOfWeek] })}
              />
              <input
                type="time"
                value={h.closesAt}
                disabled={h.isClosed}
                onChange={(e) => setHour(i, { closesAt: e.target.value })}
                aria-label={format(t.storeForm.closesAt, { day: DAY_LABELS[h.dayOfWeek] })}
              />
              <label className="closed">
                <input type="checkbox" checked={h.isClosed} onChange={(e) => setHour(i, { isClosed: e.target.checked })} />
                {t.storeForm.closed}
              </label>
            </div>
          ))}
        </section>

        {/* Amenities ---------------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.amenities}</h2>
          {form.amenities.map((a, i) => (
            <div className="row amenity" key={i}>
              <input value={a} onChange={(e) => setAmenity(i, e.target.value)} placeholder={t.storeForm.amenityPlaceholder} />
              <button type="button" className="btn-remove" onClick={() => set("amenities", removeAt(form.amenities, i))}>
                {t.common.remove}
              </button>
            </div>
          ))}
          <button type="button" className="btn-add" onClick={() => set("amenities", [...form.amenities, ""])}>
            {t.storeForm.addAmenity}
          </button>
        </section>

        {/* Photos (hero + about) --------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.photos}</h2>
          <ImageUpload
            label={t.storeForm.bannerPhoto}
            assetType="hero"
            value={form.heroImageUrl}
            onChange={(url) => set("heroImageUrl", url)}
          />
          <ImageUpload
            label={t.storeForm.aboutPhoto}
            assetType="about"
            value={form.aboutImageUrl}
            onChange={(url) => set("aboutImageUrl", url)}
          />
        </section>

        {/* Gallery ------------------------------------------------------ */}
        <section className="section">
          <h2>{t.storeForm.galleryPhotos}</h2>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            {t.storeForm.galleryHint}
          </p>
          <GalleryUpload assetType="gallery" value={form.gallery} onChange={(rows) => set("gallery", rows)} />
        </section>

        {/* Services ----------------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.services}</h2>
          {form.services.map((s, i) => (
            <div className="row service" key={i}>
              <div className="field">
                <label>{t.storeForm.serviceName}</label>
                <input value={s.name} onChange={(e) => setService(i, { name: e.target.value })} />
              </div>
              <div className="field">
                <label>{t.storeForm.duration}</label>
                <input
                  value={s.durationMinutes || ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") return setService(i, { durationMinutes: 0 });
                    const n = Number(v);
                    if (!Number.isNaN(n)) setService(i, { durationMinutes: n });
                  }}
                  inputMode="numeric"
                />
              </div>
              <div className="field">
                <label>{format(t.storeForm.price, { symbol: currencySymbol(form.currency) })}</label>
                <input
                  value={s.priceRupees || ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") return setService(i, { priceRupees: 0 });
                    const n = Number(v);
                    if (!Number.isNaN(n)) setService(i, { priceRupees: n });
                  }}
                  inputMode="numeric"
                />
              </div>
              <button type="button" className="btn-remove" onClick={() => set("services", removeAt(form.services, i))}>
                {t.common.remove}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-add"
            onClick={() => set("services", [...form.services, { name: "", durationMinutes: 30, priceRupees: 0 }])}
          >
            {t.storeForm.addService}
          </button>
        </section>

        {/* Staff -------------------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.staff}</h2>
          {form.staff.map((s, i) => (
            <div className="row staff" key={i}>
              <div className="field">
                <label>{t.storeForm.staffName}</label>
                <input value={s.name} onChange={(e) => setStaff(i, { name: e.target.value })} />
              </div>
              <div className="field">
                <label>{t.storeForm.staffRole}</label>
                <input value={s.roleLabel} onChange={(e) => setStaff(i, { roleLabel: e.target.value })} placeholder={t.storeForm.staffRolePlaceholder} />
              </div>
              <button type="button" className="btn-remove" onClick={() => set("staff", removeAt(form.staff, i))}>
                {t.common.remove}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-add"
            onClick={() => set("staff", [...form.staff, { name: "", roleLabel: "" }])}
          >
            {t.storeForm.addStaff}
          </button>
        </section>

        {/* Good to know (FAQ) ------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.faqTitle}</h2>
          {form.faqs.length === 0 && <p className="hint">{t.storeForm.faqEmpty}</p>}
          {form.faqs.map((x, i) => (
            <div className="row faq" key={i}>
              <div className="field">
                <label>{t.storeForm.faqQuestion}</label>
                <input value={x.q} onChange={(e) => setFaq(i, { q: e.target.value })} placeholder={t.storeForm.faqQuestionPlaceholder} />
              </div>
              <div className="field">
                <label>{t.storeForm.faqAnswer}</label>
                <input value={x.a} onChange={(e) => setFaq(i, { a: e.target.value })} placeholder={t.storeForm.faqAnswerPlaceholder} />
              </div>
              <button type="button" className="btn-remove" onClick={() => set("faqs", removeAt(form.faqs, i))}>
                {t.common.remove}
              </button>
            </div>
          ))}
          <button type="button" className="btn-add" onClick={() => set("faqs", [...form.faqs, { q: "", a: "" }])}>
            {t.storeForm.addFaq}
          </button>
        </section>

        {/* Customer reviews -------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.reviewsTitle}</h2>
          {form.reviews.length === 0 && <p className="hint">{t.storeForm.reviewsEmpty}</p>}
          {form.reviews.map((r, i) => (
            <div className="row review" key={i}>
              <div className="field">
                <label>{t.storeForm.reviewRating}</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setReview(i, { stars: n })}
                      aria-label={format(n === 1 ? t.storeForm.reviewStars : t.storeForm.reviewStarsPlural, { n })}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 1, color: n <= r.stars ? "var(--brand-accent)" : "var(--gray-300)" }}
                    >
                      <Icon name="star" filled size={22} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>{t.storeForm.reviewText}</label>
                <input value={r.text} onChange={(e) => setReview(i, { text: e.target.value })} maxLength={1000} placeholder={t.storeForm.reviewTextPlaceholder} />
              </div>
              <div className="field">
                <label>{t.storeForm.reviewName}</label>
                <input value={r.authorName} onChange={(e) => setReview(i, { authorName: e.target.value })} maxLength={120} placeholder={t.storeForm.reviewNamePlaceholder} />
              </div>
              <button type="button" className="btn-remove" onClick={() => set("reviews", removeAt(form.reviews, i))}>
                {t.common.remove}
              </button>
            </div>
          ))}
          <button type="button" className="btn-add" onClick={() => set("reviews", [...form.reviews, { stars: 5, text: "", authorName: "" }])}>
            {t.storeForm.addReview}
          </button>
        </section>

        {/* Owner login (create only) ------------------------------------ */}
        {mode === "create" && (
          <section className="section">
            <h2>{t.storeForm.ownerLogin}</h2>
            <div className="grid">
              <div className="field">
                <label htmlFor="sf-ownerPhone">{t.storeForm.ownerPhone}</label>
                <input id="sf-ownerPhone" value={phoneFull} readOnly />
                <p className="hint">{t.storeForm.ownerPhoneHint}</p>
              </div>
              <div className="field">
                <label htmlFor="sf-ownerPassword">{t.storeForm.password}</label>
                <input id="sf-ownerPassword" type="text" value={form.ownerPassword} onChange={(e) => set("ownerPassword", e.target.value)} minLength={6} required />
              </div>
            </div>
          </section>
        )}

        <div className="actions">
          <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving || undefined}>
            {saving && <Spinner className="btn-spinner" />}
            {saving ? t.storeForm.saving : mode === "create" ? t.storeForm.createStore : t.storeForm.saveChanges}
          </button>
          {saving && <span className="hint">{t.storeForm.workingHint}</span>}
        </div>
      </form>
    </div>
  );
}
