"use client";

import { useRouter } from "next/navigation";
import { t, format } from "@/i18n";
import { useState, useTransition } from "react";

import { GalleryEditor, type GalleryImage } from "@/components/GalleryEditor";
import { Icon } from "@/components/Icon";
import { ImageField } from "@/components/ImageField";
import { Spinner } from "@/components/Skeleton";
import { SbField, SbSection } from "@/components/store-settings/ui";
import { showToast } from "@/lib/toast";
import type { BusinessDetail } from "@/lib/server-api";

/**
 * The owner's editor for their own store's public profile — the web twin of the app's
 * OwnerStoreProfileForm: the same nine sections in the same order (Basics, Where you are, Your
 * story, Pictures, Social links, Photos, What you offer, Common questions, Customer reviews), each
 * a titled card, ending in one Save.
 *
 * Appearance used to be a tenth section here, saved by the same button. It is its own page now
 * (/settings/appearance), as it is in the app: the theme is one object saved on its own, and a
 * profile save no longer carries it — PATCH /business is partial, so leaving it out leaves the
 * theme exactly as it was.
 *
 * It is NOT the admin StoreForm ported across. Deliberately absent:
 *   - creating a business, or picking which business to edit — the id comes from the token
 *   - changing the phone number, which is the login identity AND the microsite's URL key (it is
 *     shown read-only with the reason, as in the app)
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
  yelpUrl: string;
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
    yelpUrl: b.yelpUrl ?? "",
  };
}

const SOCIALS: { key: keyof Draft; label: string; placeholder: string }[] = [
  { key: "instagramUrl", label: t.profile.socials.instagram, placeholder: "https://instagram.com/yourshop" },
  { key: "facebookUrl", label: t.profile.socials.facebook, placeholder: "https://facebook.com/yourshop" },
  { key: "twitterUrl", label: t.profile.socials.twitter, placeholder: "https://x.com/yourshop" },
  { key: "linkedinUrl", label: t.profile.socials.linkedin, placeholder: "https://linkedin.com/company/yourshop" },
  { key: "yelpUrl", label: t.profile.socials.yelp, placeholder: "https://yelp.com/biz/yourshop" },
];

export function StoreProfileEditor({ business }: { business: BusinessDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => toDraft(business));
  const [saved, setSaved] = useState<Draft>(() => toDraft(business));
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

  const listsNow = listsSnapshot(payments, amenities, gallery, faqs, reviews);
  const listsDirty = listsNow !== savedLists;
  const dirty = listsDirty || (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== saved[k]);

  async function save() {
    if (!draft.name.trim()) {
      setError(t.profile.errName);
      return;
    }
    // Same bounds as the app: a typo like "20144" is caught here, naming the field, instead of
    // coming back from the API as a generic 400.
    const year = draft.establishedYear.trim();
    const yearNum = year ? Number(year) : null;
    if (yearNum !== null && (!Number.isInteger(yearNum) || yearNum < 1800 || yearNum > 2100)) {
      setError(t.profile.yearInvalid);
      return;
    }
    setInFlight(true);
    setError("");
    try {
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
          establishedYear: yearNum,
          // Always send image fields — '' is how you CLEAR them (same as socials).
          logoUrl: draft.logoUrl.trim(),
          heroImageUrl: draft.heroImageUrl.trim(),
          aboutImageUrl: draft.aboutImageUrl.trim(),
          instagramUrl: draft.instagramUrl.trim(),
          facebookUrl: draft.facebookUrl.trim(),
          twitterUrl: draft.twitterUrl.trim(),
          linkedinUrl: draft.linkedinUrl.trim(),
          yelpUrl: draft.yelpUrl.trim(),
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
          setError(j?.error?.message ?? format(t.profile.errPartial, { label }));
          startTransition(() => router.refresh());
          return;
        }
      }

      const nextFaqs = faqs.filter((f) => f.q.trim() && f.a.trim());
      const nextReviews = reviews.filter((r) => r.text.trim() && r.authorName.trim());
      setSaved(structuredClone(draft));
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

  const dial = business.countryCode ? `+${business.countryCode}` : undefined;

  return (
    <>
      <SbSection title={t.profile.secBasics}>
        <SbField id="sp-name" label={t.profile.name}>
          <input id="sp-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </SbField>
        <SbField id="sp-category" label={t.profile.category} hint={t.profile.categoryHint}>
          <input
            id="sp-category"
            value={draft.category}
            onChange={(e) => set("category", e.target.value)}
            placeholder={t.profile.categoryPlaceholder}
          />
        </SbField>
        <SbField id="sp-tagline" label={t.profile.tagline}>
          <input
            id="sp-tagline"
            value={draft.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder={t.profile.taglinePlaceholder}
          />
        </SbField>
        <SbField id="sp-heroSubtitle" label={t.profile.heroSubtitle} hint={t.profile.heroSubtitleHint}>
          <input
            id="sp-heroSubtitle"
            value={draft.heroSubtitle}
            onChange={(e) => set("heroSubtitle", e.target.value)}
          />
        </SbField>
      </SbSection>

      <SbSection title={t.profile.secWhere}>
        <SbField id="sp-address" label={t.profile.address}>
          <input id="sp-address" value={draft.address} onChange={(e) => set("address", e.target.value)} />
        </SbField>
        <SbField id="sp-area" label={t.profile.area}>
          <input id="sp-area" value={draft.area} onChange={(e) => set("area", e.target.value)} />
        </SbField>
        <SbField id="sp-city" label={t.profile.city}>
          <input id="sp-city" value={draft.city} onChange={(e) => set("city", e.target.value)} />
        </SbField>
        {/* Read-only, with the reason under it — the app shows the number rather than only saying
            it cannot be changed. */}
        <SbField id="sp-phone" label={t.profile.phone} prefix={dial} hint={t.profile.phoneLockedHint} disabled>
          <input id="sp-phone" value={business.phoneNumber ?? ""} readOnly aria-readonly="true" />
        </SbField>
      </SbSection>

      <SbSection title={t.profile.secStory}>
        <SbField id="sp-aboutHeading" label={t.profile.aboutHeading}>
          <input
            id="sp-aboutHeading"
            value={draft.aboutHeading}
            onChange={(e) => set("aboutHeading", e.target.value)}
          />
        </SbField>
        <SbField id="sp-description" label={t.profile.aboutText} multiline>
          <textarea
            id="sp-description"
            rows={5}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </SbField>
        <div className="sb-row2">
          <SbField id="sp-statValue" label={t.profile.statValue}>
            <input
              id="sp-statValue"
              value={draft.statValue}
              onChange={(e) => set("statValue", e.target.value)}
              placeholder={t.profile.statValuePlaceholder}
            />
          </SbField>
          <SbField id="sp-statLabel" label={t.profile.statLabel}>
            <input
              id="sp-statLabel"
              value={draft.statLabel}
              onChange={(e) => set("statLabel", e.target.value)}
              placeholder={t.profile.statLabelPlaceholder}
            />
          </SbField>
        </div>
        <SbField id="sp-year" label={t.profile.establishedYear}>
          <input
            id="sp-year"
            inputMode="numeric"
            value={draft.establishedYear}
            onChange={(e) => set("establishedYear", e.target.value)}
            placeholder={t.profile.establishedYearPlaceholder}
          />
        </SbField>
      </SbSection>

      <SbSection title={t.profile.secPictures}>
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
      </SbSection>

      <SbSection title={t.profile.secSocial} hint={t.profile.socialHint}>
        {SOCIALS.map((s) => (
          <SbField key={s.key} id={`sp-${s.key}`} label={s.label}>
            <input
              id={`sp-${s.key}`}
              type="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={s.placeholder}
              value={draft[s.key]}
              onChange={(e) => set(s.key, e.target.value)}
            />
          </SbField>
        ))}
      </SbSection>

      <SbSection title={t.profile.secPhotos} hint={t.profile.photosHint}>
        <GalleryEditor
          images={gallery}
          onChange={(g) => {
            setGallery(g);
            setError("");
          }}
        />
      </SbSection>

      <SbSection title={t.profile.secOffer}>
        <SbField id="sp-payments" label={t.profile.payments} hint={t.profile.paymentsHint}>
          <input
            id="sp-payments"
            value={payments}
            onChange={(e) => {
              setPayments(e.target.value);
              setError("");
            }}
            placeholder={t.profile.paymentsPlaceholder}
          />
        </SbField>

        <div className="sb-block">
          <p className="sb-block-title">{t.profile.amenities}</p>
          {amenities.length === 0 ? <p className="sb-caption">{t.profile.amenitiesEmpty}</p> : null}
          {amenities.map((a, i) => (
            <div className="sb-listrow" key={i}>
              <SbField>
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
              </SbField>
              <button
                type="button"
                className="sb-iconbtn"
                onClick={() => setAmenities((xs) => xs.filter((_, idx) => idx !== i))}
                aria-label={t.profile.removeAmenity}
                title={t.profile.remove}
              >
                <Icon name="x" size={18} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="sb-btn sb-btn--secondary sb-self-start"
            onClick={() => setAmenities((xs) => [...xs, ""])}
          >
            {t.profile.addAmenity}
          </button>
        </div>
      </SbSection>

      <SbSection title={t.profile.secFaq} hint={t.profile.faqHint}>
        {faqs.map((f, i) => (
          <div className="sb-nested" key={i}>
            <SbField id={`sp-faq-q-${i}`} label={t.profile.faqQuestion}>
              <input
                id={`sp-faq-q-${i}`}
                value={f.q}
                onChange={(e) => {
                  const v = e.target.value;
                  setFaqs((xs) => xs.map((x, idx) => (idx === i ? { ...x, q: v } : x)));
                  setError("");
                }}
              />
            </SbField>
            <SbField id={`sp-faq-a-${i}`} label={t.profile.faqAnswer} multiline>
              <textarea
                id={`sp-faq-a-${i}`}
                rows={3}
                value={f.a}
                onChange={(e) => {
                  const v = e.target.value;
                  setFaqs((xs) => xs.map((x, idx) => (idx === i ? { ...x, a: v } : x)));
                  setError("");
                }}
              />
            </SbField>
            <button
              type="button"
              className="sb-btn sb-btn--secondary sb-btn--sm"
              onClick={() => setFaqs((xs) => xs.filter((_, idx) => idx !== i))}
            >
              {t.profile.removeQuestion}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="sb-btn sb-btn--secondary sb-self-start"
          onClick={() => setFaqs((xs) => [...xs, { q: "", a: "" }])}
        >
          {t.profile.addQuestion}
        </button>
      </SbSection>

      <SbSection title={t.profile.secReviews} hint={t.profile.reviewsHint}>
        {reviews.map((r, i) => (
          <div className="sb-nested" key={i}>
            <SbField id={`sp-rev-a-${i}`} label={t.profile.reviewName}>
              <input
                id={`sp-rev-a-${i}`}
                value={r.authorName}
                onChange={(e) => {
                  const v = e.target.value;
                  setReviews((xs) => xs.map((x, idx) => (idx === i ? { ...x, authorName: v } : x)));
                  setError("");
                }}
              />
            </SbField>
            {/* A 1–5 picker rather than the app's number box: a browser has one, and it cannot
                hold an out-of-range value to be clamped later. */}
            <SbField id={`sp-rev-s-${i}`} label={t.profile.reviewStars}>
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
            </SbField>
            <SbField id={`sp-rev-t-${i}`} label={t.profile.reviewText} multiline>
              <textarea
                id={`sp-rev-t-${i}`}
                rows={3}
                value={r.text}
                onChange={(e) => {
                  const v = e.target.value;
                  setReviews((xs) => xs.map((x, idx) => (idx === i ? { ...x, text: v } : x)));
                  setError("");
                }}
              />
            </SbField>
            <button
              type="button"
              className="sb-btn sb-btn--secondary sb-btn--sm"
              onClick={() => setReviews((xs) => xs.filter((_, idx) => idx !== i))}
            >
              {t.profile.removeReview}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="sb-btn sb-btn--secondary sb-self-start"
          onClick={() => setReviews((xs) => [...xs, { stars: 5, text: "", authorName: "" }])}
        >
          {t.profile.addReview}
        </button>
      </SbSection>

      {error ? (
        <p className="sb-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sb-savebar">
        <span className={`sb-savebar-note${dirty ? " is-dirty" : ""}`} role="status">
          {dirty ? t.profile.dirty : t.profile.clean}
        </span>
        <div className="sb-savebar-btns">
          <button
            type="button"
            className="sb-btn sb-btn--primary sb-btn--lg sb-btn--block"
            onClick={save}
            disabled={busy || !dirty}
          >
            {busy ? <Spinner size={16} /> : null}
            {busy ? t.profile.saving : t.profile.save}
          </button>
        </div>
      </div>
    </>
  );
}
