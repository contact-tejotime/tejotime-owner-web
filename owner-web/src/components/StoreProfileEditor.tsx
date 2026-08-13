"use client";

import { useRouter } from "next/navigation";
import { t, format } from "@/i18n";
import { useState, useTransition } from "react";

import { GalleryEditor, type GalleryImage } from "@/components/GalleryEditor";
import AppearancePanel from "@/components/appearance/AppearancePanel";
import { Icon } from "@/components/Icon";
import { ImageField } from "@/components/ImageField";
import { Spinner } from "@/components/Skeleton";
import { showToast } from "@/lib/toast";
import type { BusinessDetail } from "@/lib/server-api";
import {
  LEGACY_THEME_CONFIG,
  normalizeThemeConfig,
  type ThemeConfig,
} from "@/theme/engine";

/**
 * The owner's editor for their own store's public profile.
 *
 * This replaces a two-field form whose comment said the richer profile was "the admin panel's
 * job". That was true when only platform admins could edit a store; it is not any more, and the
 * cost of it being true was that an owner who wanted to fix their own tagline had to ask
 * someone at TejoTime.
 *
 * It is NOT the admin StoreForm ported across. Deliberately absent:
 *   - creating a business, or picking which business to edit — the id comes from the token
 *   - phone number, which is the login identity AND the microsite's URL key
 *   - currency, which would retroactively mislabel every price already recorded
 *   - rating / review count, which are the platform's numbers, not the shop's
 *   - active/inactive, which is a platform decision about whether a store is live
 *
 * Everything here is owner/co-owner only. The nav hides it from staff and the API refuses it
 * for them — see BASE_COLUMNS vs OWNER_ONLY_COLUMNS in the backend's business.service.
 */

type Draft = {
  name: string;
  category: string;
  tagline: string;
  heroSubtitle: string;
  area: string;
  city: string;
  address: string;
  establishedYear: string;
  aboutHeading: string;
  description: string;
  statValue: string;
  statLabel: string;
  logoUrl: string;
  heroImageUrl: string;
  aboutImageUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  twitterUrl: string;
  linkedinUrl: string;
};

function toDraft(b: BusinessDetail): Draft {
  return {
    name: b.name ?? "",
    category: b.category ?? "",
    tagline: b.tagline ?? "",
    heroSubtitle: b.heroSubtitle ?? "",
    area: b.area ?? "",
    city: b.city ?? "",
    address: b.address ?? "",
    establishedYear: b.establishedYear != null ? String(b.establishedYear) : "",
    aboutHeading: b.aboutHeading ?? "",
    description: b.description ?? "",
    statValue: b.statValue ?? "",
    statLabel: b.statLabel ?? "",
    logoUrl: b.logoUrl ?? "",
    heroImageUrl: b.heroImageUrl ?? "",
    aboutImageUrl: b.aboutImageUrl ?? "",
    instagramUrl: b.instagramUrl ?? "",
    facebookUrl: b.facebookUrl ?? "",
    twitterUrl: b.twitterUrl ?? "",
    linkedinUrl: b.linkedinUrl ?? "",
  };
}

const SOCIALS: { key: keyof Draft; label: string; placeholder: string }[] = [
  { key: "instagramUrl", label: t.profile.socials.instagram, placeholder: "https://instagram.com/yourshop" },
  { key: "facebookUrl", label: t.profile.socials.facebook, placeholder: "https://facebook.com/yourshop" },
  { key: "twitterUrl", label: t.profile.socials.twitter, placeholder: "https://x.com/yourshop" },
  { key: "linkedinUrl", label: t.profile.socials.linkedin, placeholder: "https://linkedin.com/company/yourshop" },
];

function themeFromBusiness(b: BusinessDetail): ThemeConfig {
  const legacyBrand =
    typeof b.themeColor === "string" && /^#[0-9A-Fa-f]{6}$/.test(b.themeColor)
      ? b.themeColor.toUpperCase()
      : "#2563EB";
  return normalizeThemeConfig(b.theme, { ...LEGACY_THEME_CONFIG, brand: legacyBrand });
}

export function StoreProfileEditor({ business }: { business: BusinessDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => toDraft(business));
  const [saved, setSaved] = useState<Draft>(() => toDraft(business));
  /**
   * Appearance is kept beside the text draft rather than inside it, because it is saved as a
   * whole object: the API merges `theme.brand` into `theme_color` for us, and sending a partial
   * theme is how a store ends up with a colour its microsite ignores.
   */
  const initialTheme = themeFromBusiness(business);
  const [theme, setTheme] = useState<ThemeConfig>(initialTheme);
  const [savedTheme, setSavedTheme] = useState<ThemeConfig>(initialTheme);
  const phoneFull = `${business.countryCode ?? ""}${business.phoneNumber ?? ""}`.replace(/\D/g, "");
  // Content lists. Each saves through its own endpoint, but behind the one Save button below —
  // the owner is editing one page, not five resources.
  const [payments, setPayments] = useState<string>(() => (business.payments ?? []).join(", "));
  const [amenities, setAmenities] = useState<string[]>(() => business.amenities ?? []);
  const [gallery, setGallery] = useState<GalleryImage[]>(
    () => (business.gallery ?? []).map((g) => ({ url: g.url, alt: g.alt })),
  );
  const [faqs, setFaqs] = useState(() => business.faqs ?? []);
  const [reviews, setReviews] = useState(() => business.reviews ?? []);
  const listsSnapshot = (p: string, a: string[], g: GalleryImage[], f: typeof faqs, r: typeof reviews) =>
    JSON.stringify({ payments: p, amenities: a, gallery: g, faqs: f, reviews: r });
  const [savedLists, setSavedLists] = useState(() =>
    listsSnapshot(
      (business.payments ?? []).join(", "),
      business.amenities ?? [],
      (business.gallery ?? []).map((g) => ({ url: g.url, alt: g.alt })),
      business.faqs ?? [],
      business.reviews ?? [],
    ),
  );

  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState("");
  const busy = inFlight || isPending;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError("");
  };

  const themeDirty = JSON.stringify(theme) !== JSON.stringify(savedTheme);
  const listsNow = listsSnapshot(payments, amenities, gallery, faqs, reviews);
  const listsDirty = listsNow !== savedLists;
  const dirty =
    themeDirty ||
    listsDirty ||
    (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== saved[k]);

  async function save() {
    if (!draft.name.trim()) {
      setError(t.profile.errName);
      return;
    }
    setInFlight(true);
    setError("");
    try {
      const year = draft.establishedYear.trim();
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          category: draft.category.trim(),
          tagline: draft.tagline.trim(),
          heroSubtitle: draft.heroSubtitle.trim(),
          area: draft.area.trim(),
          city: draft.city.trim(),
          address: draft.address.trim(),
          aboutHeading: draft.aboutHeading.trim(),
          description: draft.description.trim(),
          statValue: draft.statValue.trim(),
          statLabel: draft.statLabel.trim(),
          // Empty clears the year; a number sets it.
          establishedYear: year ? Number(year) : null,
          // Always send image fields — '' is how you CLEAR them (same as socials).
          logoUrl: draft.logoUrl.trim(),
          heroImageUrl: draft.heroImageUrl.trim(),
          aboutImageUrl: draft.aboutImageUrl.trim(),
          instagramUrl: draft.instagramUrl.trim(),
          facebookUrl: draft.facebookUrl.trim(),
          twitterUrl: draft.twitterUrl.trim(),
          linkedinUrl: draft.linkedinUrl.trim(),
          // The full object, never just the colour — the backend dual-writes brand into the
          // legacy column from here, and a lone `themeColor` is the drift path.
          theme,
          payments: payments
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          faqs: faqs.filter((f) => f.q.trim() && f.a.trim()),
          reviews: reviews.filter((r) => r.text.trim() && r.authorName.trim()),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? t.profile.errSave);
        return;
      }

      /*
       * Amenities and the gallery are separate replace-endpoints (they own their own tables),
       * so a full save is three calls. Sequential and stop-on-failure: if amenities fail there
       * is no point pushing the gallery, and reporting success after a partial write would be
       * worse than reporting the error.
       */
      const nextAmenities = amenities.map((a) => a.trim()).filter(Boolean);
      const nextGallery = gallery;
      const extras: [string, unknown, string][] = [
        ["/api/business/amenities", { amenities: nextAmenities }, t.profile.labelAmenities],
        ["/api/business/gallery", { images: nextGallery }, t.profile.labelPhotos],
      ];
      for (const [url, body, label] of extras) {
        const r = await fetch(url, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          // Profile text already saved — say so, then align baselines + refresh.
          setSaved(structuredClone(draft));
          setSavedTheme(structuredClone(theme));
          setError(
            j?.error?.message ??
              format(t.profile.errPartial, { label }),
          );
          startTransition(() => router.refresh());
          return;
        }
      }

      const nextFaqs = faqs.filter((f) => f.q.trim() && f.a.trim());
      const nextReviews = reviews.filter((r) => r.text.trim() && r.authorName.trim());
      setSaved(structuredClone(draft));
      setSavedTheme(structuredClone(theme));
      setFaqs(nextFaqs);
      setReviews(nextReviews);
      setAmenities(nextAmenities);
      setSavedLists(listsSnapshot(payments, nextAmenities, nextGallery, nextFaqs, nextReviews));
      showToast(t.profile.okSaved, "success");
      startTransition(() => router.refresh());
    } catch {
      setError(t.profile.networkError);
    } finally {
      setInFlight(false);
    }
  }

  return (
    <>
      <div className="section">
        <h2>{t.profile.secBasics}</h2>
        <div className="field">
          <label htmlFor="sp-name">{t.profile.name}</label>
          <input id="sp-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sp-category">{t.profile.category}</label>
          <input
            id="sp-category"
            value={draft.category}
            onChange={(e) => set("category", e.target.value)}
            placeholder={t.profile.categoryPlaceholder}
          />
          <p className="field-hint">{t.profile.categoryHint}</p>
        </div>
        <div className="field">
          <label htmlFor="sp-tagline">{t.profile.tagline}</label>
          <input
            id="sp-tagline"
            value={draft.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder={t.profile.taglinePlaceholder}
          />
        </div>
        <div className="field">
          <label htmlFor="sp-heroSubtitle">{t.profile.heroSubtitle}</label>
          <input
            id="sp-heroSubtitle"
            value={draft.heroSubtitle}
            onChange={(e) => set("heroSubtitle", e.target.value)}
          />
          <p className="field-hint">{t.profile.heroSubtitleHint}</p>
        </div>
      </div>

      <div className="section">
        <h2>{t.profile.secWhere}</h2>
        <div className="field">
          <label htmlFor="sp-address">{t.profile.address}</label>
          <input id="sp-address" value={draft.address} onChange={(e) => set("address", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sp-area">{t.profile.area}</label>
          <input id="sp-area" value={draft.area} onChange={(e) => set("area", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sp-city">{t.profile.city}</label>
          <input id="sp-city" value={draft.city} onChange={(e) => set("city", e.target.value)} />
        </div>
        <p className="field-hint">
          {t.profile.phoneLockedHint}
        </p>
      </div>

      <div className="section">
        <h2>{t.profile.secStory}</h2>
        <div className="field">
          <label htmlFor="sp-aboutHeading">{t.profile.aboutHeading}</label>
          <input
            id="sp-aboutHeading"
            value={draft.aboutHeading}
            onChange={(e) => set("aboutHeading", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="sp-description">{t.profile.aboutText}</label>
          <textarea
            id="sp-description"
            rows={5}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="sp-statValue">{t.profile.statValue}</label>
            <input
              id="sp-statValue"
              value={draft.statValue}
              onChange={(e) => set("statValue", e.target.value)}
              placeholder={t.profile.statValuePlaceholder}
            />
          </div>
          <div className="field">
            <label htmlFor="sp-statLabel">{t.profile.statLabel}</label>
            <input
              id="sp-statLabel"
              value={draft.statLabel}
              onChange={(e) => set("statLabel", e.target.value)}
              placeholder={t.profile.statLabelPlaceholder}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sp-year">{t.profile.establishedYear}</label>
          <input
            id="sp-year"
            inputMode="numeric"
            value={draft.establishedYear}
            onChange={(e) => set("establishedYear", e.target.value)}
            placeholder={t.profile.establishedYearPlaceholder}
          />
        </div>
      </div>

      <div className="section">
        <h2>{t.profile.secPictures}</h2>
        <ImageField
          label={t.profile.logo}
          assetType="logo"
          value={draft.logoUrl}
          onChange={(url) => set("logoUrl", url)}
        />
        <ImageField
          label={t.profile.heroImage}
          assetType="hero"
          value={draft.heroImageUrl}
          onChange={(url) => set("heroImageUrl", url)}
          hint={t.profile.heroImageHint}
        />
        <ImageField
          label={t.profile.aboutImage}
          assetType="about"
          value={draft.aboutImageUrl}
          onChange={(url) => set("aboutImageUrl", url)}
        />
      </div>

      <div className="section">
        <h2>{t.profile.secSocial}</h2>
        <p className="field-hint">
          {t.profile.socialHint}
        </p>
        {/* Four short URL fields pair up from 560px, matching the stat/hero rows above. */}
        <div className="field-row">
          {SOCIALS.map((s) => (
            <div className="field" key={s.key}>
              <label htmlFor={`sp-${s.key}`}>{s.label}</label>
              <input
                id={`sp-${s.key}`}
                type="url"
                inputMode="url"
                placeholder={s.placeholder}
                value={draft[s.key]}
                onChange={(e) => set(s.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h2>{t.profile.secPhotos}</h2>
        <p className="field-hint">
          {t.profile.photosHint}
        </p>
        <GalleryEditor images={gallery} onChange={(g) => { setGallery(g); setError(""); }} />
      </div>

      <div className="section">
        <h2>{t.profile.secOffer}</h2>
        <div className="field">
          <label htmlFor="sp-payments">{t.profile.payments}</label>
          <input
            id="sp-payments"
            value={payments}
            onChange={(e) => { setPayments(e.target.value); setError(""); }}
            placeholder={t.profile.paymentsPlaceholder}
          />
          <p className="field-hint">{t.profile.paymentsHint}</p>
        </div>

        <div className="field">
          <label>{t.profile.amenities}</label>
          {amenities.length === 0 ? (
            <p className="field-hint">
              {t.profile.amenitiesEmpty}
            </p>
          ) : null}
          {amenities.map((a, i) => (
            <div className="list-row" key={i}>
              <input
                value={a}
                onChange={(e) => {
                  const v = e.target.value;
                  setAmenities((xs) => xs.map((x, idx) => (idx === i ? v : x)));
                  setError("");
                }}
                placeholder={t.profile.amenityPlaceholder}
                aria-label={format(t.profile.amenityAria, { index: i + 1 })}
              />
              <button
                type="button"
                className="btn secondary btn-sm btn-icon"
                onClick={() => setAmenities((xs) => xs.filter((_, idx) => idx !== i))}
                aria-label={t.profile.removeAmenity}
                title={t.profile.remove}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => setAmenities((xs) => [...xs, ""])}
          >
            <Icon name="plus" size={14} />
            {t.profile.addAmenity}
          </button>
        </div>
      </div>

      <div className="section">
        <h2>{t.profile.secFaq}</h2>
        <p className="field-hint">
          {t.profile.faqHint}
        </p>
        {faqs.map((f, i) => (
          <div className="list-card" key={i}>
            <div className="field">
              <label htmlFor={`sp-faq-q-${i}`}>{t.profile.faqQuestion}</label>
              <input
                id={`sp-faq-q-${i}`}
                value={f.q}
                onChange={(e) => {
                  const v = e.target.value;
                  setFaqs((xs) => xs.map((x, idx) => (idx === i ? { ...x, q: v } : x)));
                  setError("");
                }}
              />
            </div>
            <div className="field">
              <label htmlFor={`sp-faq-a-${i}`}>{t.profile.faqAnswer}</label>
              <textarea
                id={`sp-faq-a-${i}`}
                rows={2}
                value={f.a}
                onChange={(e) => {
                  const v = e.target.value;
                  setFaqs((xs) => xs.map((x, idx) => (idx === i ? { ...x, a: v } : x)));
                  setError("");
                }}
              />
            </div>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setFaqs((xs) => xs.filter((_, idx) => idx !== i))}
            >
              {t.profile.removeQuestion}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn secondary btn-sm"
          onClick={() => setFaqs((xs) => [...xs, { q: "", a: "" }])}
        >
          <Icon name="plus" size={14} />
          {t.profile.addQuestion}
        </button>
      </div>

      <div className="section">
        <h2>{t.profile.secReviews}</h2>
        <p className="field-hint">
          {t.profile.reviewsHint}
        </p>
        {reviews.map((r, i) => (
          <div className="list-card" key={i}>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`sp-rev-a-${i}`}>{t.profile.reviewName}</label>
                <input
                  id={`sp-rev-a-${i}`}
                  value={r.authorName}
                  onChange={(e) => {
                    const v = e.target.value;
                    setReviews((xs) => xs.map((x, idx) => (idx === i ? { ...x, authorName: v } : x)));
                    setError("");
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor={`sp-rev-s-${i}`}>{t.profile.reviewStars}</label>
                <select
                  id={`sp-rev-s-${i}`}
                  value={String(r.stars)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setReviews((xs) => xs.map((x, idx) => (idx === i ? { ...x, stars: v } : x)));
                    setError("");
                  }}
                >
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor={`sp-rev-t-${i}`}>{t.profile.reviewText}</label>
              <textarea
                id={`sp-rev-t-${i}`}
                rows={2}
                value={r.text}
                onChange={(e) => {
                  const v = e.target.value;
                  setReviews((xs) => xs.map((x, idx) => (idx === i ? { ...x, text: v } : x)));
                  setError("");
                }}
              />
            </div>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setReviews((xs) => xs.filter((_, idx) => idx !== i))}
            >
              {t.profile.removeReview}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn secondary btn-sm"
          onClick={() => setReviews((xs) => [...xs, { stars: 5, text: "", authorName: "" }])}
        >
          <Icon name="plus" size={14} />
          {t.profile.addReview}
        </button>
      </div>

      <AppearancePanel
        theme={theme}
        onChange={(next) => {
          setTheme(next);
          setError("");
        }}
        category={draft.category}
        phoneFull={phoneFull}
        savedTheme={savedTheme}
      />

      {error ? (
        <div className="alert err" role="alert">
          {error}
        </div>
      ) : null}

      {/* Sticky so the save button is reachable without scrolling back up a long form. */}
      <div className="save-bar">
        <span className="save-bar-note">
          {dirty ? t.profile.dirty : t.profile.clean}
        </span>
        <button type="button" className="btn" onClick={save} disabled={busy || !dirty}>
          {busy ? <Spinner size={14} /> : null}
          {busy ? t.profile.saving : t.profile.save}
        </button>
      </div>
    </>
  );
}
