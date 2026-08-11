"use client";

import { useRouter } from "next/navigation";
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
  { key: "instagramUrl", label: "Instagram", placeholder: "https://instagram.com/yourshop" },
  { key: "facebookUrl", label: "Facebook", placeholder: "https://facebook.com/yourshop" },
  { key: "twitterUrl", label: "X (Twitter)", placeholder: "https://x.com/yourshop" },
  { key: "linkedinUrl", label: "LinkedIn", placeholder: "https://linkedin.com/company/yourshop" },
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
      setError("The business needs a name.");
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
        setError(json?.error?.message ?? "Could not save your changes.");
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
        ["/api/business/amenities", { amenities: nextAmenities }, "amenities"],
        ["/api/business/gallery", { images: nextGallery }, "photos"],
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
              `Your profile was saved, but ${label} could not be updated. Try saving again.`,
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
      showToast("Store profile saved — your page is updated", "success");
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setInFlight(false);
    }
  }

  return (
    <>
      <div className="section">
        <h2>Basics</h2>
        <div className="field">
          <label htmlFor="sp-name">Business name</label>
          <input id="sp-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sp-category">Category</label>
          <input
            id="sp-category"
            value={draft.category}
            onChange={(e) => set("category", e.target.value)}
            placeholder="Salon, Barbershop, Clinic…"
          />
          <p className="field-hint">Sets the wording used across your public page.</p>
        </div>
        <div className="field">
          <label htmlFor="sp-tagline">Tagline</label>
          <input
            id="sp-tagline"
            value={draft.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder="Sharp cuts, no waiting"
          />
        </div>
        <div className="field">
          <label htmlFor="sp-heroSubtitle">Hero subtitle</label>
          <input
            id="sp-heroSubtitle"
            value={draft.heroSubtitle}
            onChange={(e) => set("heroSubtitle", e.target.value)}
          />
          <p className="field-hint">The line under the big heading at the top of your page.</p>
        </div>
      </div>

      <div className="section">
        <h2>Where you are</h2>
        <div className="field">
          <label htmlFor="sp-address">Address</label>
          <input id="sp-address" value={draft.address} onChange={(e) => set("address", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sp-area">Area</label>
          <input id="sp-area" value={draft.area} onChange={(e) => set("area", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sp-city">City</label>
          <input id="sp-city" value={draft.city} onChange={(e) => set("city", e.target.value)} />
        </div>
        <p className="field-hint">
          Your phone number is your sign-in and your page&apos;s web address, so it can only be
          changed by TejoTime support.
        </p>
      </div>

      <div className="section">
        <h2>Your story</h2>
        <div className="field">
          <label htmlFor="sp-aboutHeading">About heading</label>
          <input
            id="sp-aboutHeading"
            value={draft.aboutHeading}
            onChange={(e) => set("aboutHeading", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="sp-description">About text</label>
          <textarea
            id="sp-description"
            rows={5}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="sp-statValue">Highlight number</label>
            <input
              id="sp-statValue"
              value={draft.statValue}
              onChange={(e) => set("statValue", e.target.value)}
              placeholder="12"
            />
          </div>
          <div className="field">
            <label htmlFor="sp-statLabel">Highlight label</label>
            <input
              id="sp-statLabel"
              value={draft.statLabel}
              onChange={(e) => set("statLabel", e.target.value)}
              placeholder="years in business"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sp-year">Established year</label>
          <input
            id="sp-year"
            inputMode="numeric"
            value={draft.establishedYear}
            onChange={(e) => set("establishedYear", e.target.value)}
            placeholder="2014"
          />
        </div>
      </div>

      <div className="section">
        <h2>Pictures</h2>
        <ImageField
          label="Logo"
          assetType="logo"
          value={draft.logoUrl}
          onChange={(url) => set("logoUrl", url)}
        />
        <ImageField
          label="Hero image"
          assetType="hero"
          value={draft.heroImageUrl}
          onChange={(url) => set("heroImageUrl", url)}
          hint="The large picture at the top of your page."
        />
        <ImageField
          label="About image"
          assetType="about"
          value={draft.aboutImageUrl}
          onChange={(url) => set("aboutImageUrl", url)}
        />
      </div>

      <div className="section">
        <h2>Social links</h2>
        <p className="field-hint">
          Shown as icons at the bottom of your page. Paste the full profile address, or clear a
          box to hide it.
        </p>
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

      <div className="section">
        <h2>Photos</h2>
        <p className="field-hint">
          The gallery on your page — up to 7 photos. The first photo shows largest; use the arrows to reorder.
        </p>
        <GalleryEditor images={gallery} onChange={(g) => { setGallery(g); setError(""); }} />
      </div>

      <div className="section">
        <h2>What you offer</h2>
        <div className="field">
          <label htmlFor="sp-payments">Payments accepted</label>
          <input
            id="sp-payments"
            value={payments}
            onChange={(e) => { setPayments(e.target.value); setError(""); }}
            placeholder="UPI, Card, Cash"
          />
          <p className="field-hint">Separate each with a comma.</p>
        </div>

        <div className="field">
          <label>Amenities</label>
          {amenities.length === 0 ? (
            <p className="field-hint">
              Nothing listed. These are the small perks shown on your page — air conditioning,
              parking, card payments.
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
                placeholder="Air conditioned"
                aria-label={`Amenity ${i + 1}`}
              />
              <button
                type="button"
                className="btn secondary btn-sm btn-icon"
                onClick={() => setAmenities((xs) => xs.filter((_, idx) => idx !== i))}
                aria-label="Remove amenity"
                title="Remove"
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
            Add amenity
          </button>
        </div>
      </div>

      <div className="section">
        <h2>Common questions</h2>
        <p className="field-hint">
          Shown as a FAQ on your page. Blank rows are dropped when you save.
        </p>
        {faqs.map((f, i) => (
          <div className="list-card" key={i}>
            <div className="field">
              <label htmlFor={`sp-faq-q-${i}`}>Question</label>
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
              <label htmlFor={`sp-faq-a-${i}`}>Answer</label>
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
              Remove question
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn secondary btn-sm"
          onClick={() => setFaqs((xs) => [...xs, { q: "", a: "" }])}
        >
          <Icon name="plus" size={14} />
          Add question
        </button>
      </div>

      <div className="section">
        <h2>Customer reviews</h2>
        <p className="field-hint">
          Quotes shown on your page. These are the ones you choose to feature — your star rating
          is worked out by TejoTime and cannot be edited here.
        </p>
        {reviews.map((r, i) => (
          <div className="list-card" key={i}>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`sp-rev-a-${i}`}>Customer name</label>
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
                <label htmlFor={`sp-rev-s-${i}`}>Stars</label>
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
              <label htmlFor={`sp-rev-t-${i}`}>What they said</label>
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
              Remove review
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn secondary btn-sm"
          onClick={() => setReviews((xs) => [...xs, { stars: 5, text: "", authorName: "" }])}
        >
          <Icon name="plus" size={14} />
          Add review
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
          {dirty ? "You have unsaved changes" : "Everything is saved"}
        </span>
        <button type="button" className="btn" onClick={save} disabled={busy || !dirty}>
          {busy ? <Spinner size={14} /> : null}
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </>
  );
}
