"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DAY_LABELS,
  EMPTY_FORM,
  draftData,
  parseCommissionPercent,
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
import { timezoneForPhone } from "@/lib/phone-timezone";
import { TIMEZONE_OPTIONS } from "@/lib/timezones";
import { presetForCategory, type ThemeConfig } from "@/theme/engine";
import { t, format } from "@/i18n";
import { Icon } from "@/components/icons";
import AppearancePanel from "@/components/appearance/AppearancePanel";
import { GalleryUpload, ImageUpload } from "@/components/ImageUpload";
import { diffImportedFields } from "@/lib/import-diff";
import PhoneField from "@/components/ui/PhoneField";
import Spinner from "@/components/ui/Spinner";
import { frontendUrl } from "@/lib/frontend-url";
import {
  applyImport,
  buildImportItems,
  isPristineCreate,
  normalizeImportUrl,
  type ImportedFields,
  type ImportItem,
  type ImportKey,
  type StoreImportResponse,
} from "@/lib/store-import";
import ConfirmDialog from "@/components/ConfirmDialog";
import StoreImportReview from "@/components/StoreImportReview";

/** The page as one fetch saw it: the link and the fields it yielded (whole page, not a diff). */
type ImportSnapshot = { url: string; fields: ImportedFields };

const FRONTEND_URL = frontendUrl();

type ErrorDetail = { field?: string; message: string };

interface Props {
  mode: "create" | "edit";
  categories: Category[];
  initial?: StoreFormState;
  storeId?: string;
  /** Rendered inside the store hub (which owns the page wrapper and heading). */
  embedded?: boolean;
  /** Create only: the parked draft this form was opened from. Its presence turns autosave on. */
  draftId?: string;
  /** True on the render straight after "Save as draft", so the new draft can say it was saved. */
  justSaved?: boolean;
}

/** Autosave waits for the admin to pause typing, so a burst of keystrokes is one write. */
const AUTOSAVE_DELAY_MS = 1500;
/** Browsers cap a keepalive request body at 64 KB; past that, leave it to the normal debounce. */
const KEEPALIVE_MAX_BYTES = 60_000;

type DraftStatus = "idle" | "saving" | "saved" | "error";

/**
 * The five social links, as one list rather than five near-identical blocks of JSX.
 *
 * A full URL is required (the backend's `.url()` rejects a bare "@handle") because these become
 * clickable icons on a customer-facing page — a value that cannot be opened is worse than an
 * absent one. The placeholders show the expected shape.
 */
/** Weekly hours display order: Monday first, Sunday last (data stays keyed by the standard
 *  0=Sunday…6=Saturday `dayOfWeek`, only the row order on screen changes). */
const HOURS_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const SOCIAL_FIELDS = [
  { key: "instagramUrl", placeholder: "https://instagram.com/yourshop" },
  { key: "facebookUrl", placeholder: "https://facebook.com/yourshop" },
  { key: "twitterUrl", placeholder: "https://x.com/yourshop" },
  { key: "linkedinUrl", placeholder: "https://linkedin.com/company/yourshop" },
  { key: "yelpUrl", placeholder: "https://yelp.com/biz/yourshop" },
] as const;

export default function StoreForm({
  mode,
  categories,
  initial,
  storeId,
  embedded = false,
  draftId,
  justSaved = false,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState<StoreFormState>(initial ?? EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<ErrorDetail[]>([]);
  const [result, setResult] = useState<StoreMutationResult | null>(null);
  // The picker tracks the selected country (for flag/validation); the stored value
  // stays split across form.countryCode (dial code) + form.phoneNumber (national).
  const [phoneIso2, setPhoneIso2] = useState(() => countryByDial(form.countryCode)?.iso2 ?? DEFAULT_ISO2);
  // Appearance as last persisted — the baseline for the panel's unsaved-changes indicator.
  const [savedTheme, setSavedTheme] = useState<ThemeConfig>(form.theme);
  // Once the admin picks a preset by hand, changing the category must not overwrite it. A draft
  // counts as touched: its saved look may well be a deliberate choice, and we cannot tell.
  const presetTouched = useRef(Boolean(draftId));

  // ---- Drafts -------------------------------------------------------------------------------
  // A draft exists only because the admin clicked "Save as draft"; a form that never was one
  // stores nothing anywhere. Once it is one (`draftId`), edits autosave into it.
  const [draftStatus, setDraftStatus] = useState<DraftStatus>(justSaved ? "saved" : "idle");
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [draftError, setDraftError] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const formRef = useRef(form);
  // What the server holds. Seeded from the form as opened, so opening a draft never writes.
  const lastSaved = useRef(JSON.stringify(draftData(form)));
  // Saves run one at a time; a queued one reads the latest form when its turn comes, so a burst of
  // edits during a slow request collapses into a single follow-up write.
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  // Set once the draft is gone (discarded, deleted elsewhere, or the store was created from it):
  // from then on nothing may write to it, or an old timer would resurrect / error against it.
  const draftGone = useRef(false);
  const [newOwnerPassword, setNewOwnerPassword] = useState("");
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
  const [resettingOwnerPassword, setResettingOwnerPassword] = useState(false);
  const [ownerResetError, setOwnerResetError] = useState("");
  const [ownerResetNotice, setOwnerResetNotice] = useState("");
  // Autofill from a link. `importReview` holds the response AND the items built against the form
  // as it was when the response arrived; the dialog is modal, so the form cannot move underneath it.
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  // Set once a fetch has been applied to this form. After that the form holds imported data, so a
  // later fetch goes through the review dialog (which protects against duplicates and overwrites).
  const hasImported = useRef(false);
  // What the page said the last time a fetch of it was applied (or found nothing to apply). A
  // re-fetch of the SAME link is diffed against this, so it offers only what the page changed —
  // not everything that differs from a form the admin has since edited by hand.
  const lastImport = useRef<ImportSnapshot | null>(null);
  const [importReview, setImportReview] = useState<{
    response: StoreImportResponse;
    items: ImportItem[];
    /** True when `response.fields` is a diff against the previous fetch, not the whole page. */
    changesOnly: boolean;
    snapshot: ImportSnapshot;
  } | null>(null);

  const set = <K extends keyof StoreFormState>(key: K, value: StoreFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /**
   * Appearance edits land here. `themeColor` is kept byte-identical to `theme.brand` so the
   * legacy field — still validated below, still sent in the payload, still dual-written by the
   * backend — can never drift from the config the microsite actually renders.
   */
  const setTheme = (next: ThemeConfig) => {
    if (next.preset !== form.theme.preset) presetTouched.current = true;
    setForm((f) => ({ ...f, theme: next, themeColor: next.brand }));
  };

  /**
   * Category drives the *suggested* preset, for NEW stores only and only until the admin picks
   * one themselves. An existing store's look never moves because someone re-categorised it.
   */
  const setCategory = (value: string) => {
    setForm((f) =>
      mode === "create" && !presetTouched.current
        ? { ...f, category: value, theme: { ...f.theme, preset: presetForCategory(value) } }
        : { ...f, category: value },
    );
  };

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  /** PUT the current form into the open draft, if it changed since the last write. */
  const runDraftSave = useCallback(
    async (keepalive: boolean) => {
      if (!draftId || draftGone.current) return;
      const snapshot = JSON.stringify(draftData(formRef.current));
      if (snapshot === lastSaved.current) return;
      const body = `{"data":${snapshot}}`;
      // A page that is closing cannot wait for a normal request; keepalive lets it finish. It has a
      // size cap, so an oversized form simply relies on the debounced save instead.
      if (keepalive && body.length > KEEPALIVE_MAX_BYTES) return;
      setDraftStatus("saving");
      try {
        const res = await fetch(`/api/store-drafts/${draftId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body,
          keepalive,
        });
        if (res.status === 404) {
          // Gone elsewhere. Do NOT quietly recreate it: the admin may have discarded it on purpose.
          draftGone.current = true;
          setDraftError(t.storeDraft.gone);
          setDraftStatus("error");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        lastSaved.current = snapshot;
        setDraftError("");
        setDraftSavedAt(new Date());
        setDraftStatus("saved");
      } catch {
        setDraftError(t.storeDraft.saveFailed);
        setDraftStatus("error");
      }
    },
    [draftId],
  );

  const queueDraftSave = useCallback(
    (keepalive = false) => {
      saveChain.current = saveChain.current.then(() => runDraftSave(keepalive));
      return saveChain.current;
    },
    [runDraftSave],
  );

  // Autosave: a moment after the admin stops editing an open draft.
  useEffect(() => {
    if (!draftId) return;
    const timer = setTimeout(() => void queueDraftSave(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [form, draftId, queueDraftSave]);

  // Flush when the admin switches tab or leaves — this is the "went off to other work" case, and
  // the debounce above would otherwise still be waiting when the page goes away. Also runs on
  // unmount, which covers client-side navigation to another screen.
  useEffect(() => {
    if (!draftId) return;
    const flush = () => void queueDraftSave(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [draftId, queueDraftSave]);

  /** Remove the draft on the server. Best-effort: a failure must never block the caller. */
  async function deleteDraft() {
    if (!draftId) return;
    draftGone.current = true; // stops any pending or late autosave before it can recreate an error
    try {
      await fetch(`/api/store-drafts/${draftId}`, { method: "DELETE" });
    } catch {
      // The draft lingers in the sidebar and can be discarded from there; nothing else depends on it.
    }
  }

  /**
   * The only thing that creates a draft. Needs no validation — a draft is allowed to be
   * incomplete, that is the point. On an existing draft it just saves now instead of waiting.
   */
  async function saveAsDraft() {
    if (draftBusy || saving) return;
    setDraftBusy(true);
    setError(null);
    setDetails([]);
    try {
      if (draftId && !draftGone.current) {
        await queueDraftSave();
        // runDraftSave leaves the status alone when nothing changed; the click still deserves an answer.
        setDraftStatus((s) => (s === "error" ? s : "saved"));
        return;
      }
      const res = await fetch("/api/store-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: draftData(form) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message ?? format(t.storeForm.requestFailed, { status: res.status }));
        setDetails(json?.error?.details ?? []);
        return;
      }
      // Reopen it as a draft. The page key changes with `?draft=`, so the form remounts from what
      // was just saved with autosave on; refresh re-renders the layout so the sidebar lists it.
      router.replace(`/?draft=${(json as { id: string }).id}&saved=1`, { scroll: false });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.storeForm.somethingWrong);
    } finally {
      setDraftBusy(false);
    }
  }

  /**
   * Discarding is destructive and permanent, so it asks first — with the app's own ConfirmDialog
   * (focus-trapped, Escape/overlay to cancel, a red confirm button, busy state) rather than the
   * browser's native `window.confirm`, which looks like a foreign system alert.
   */
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  async function confirmDiscardDraft() {
    if (discarding) return;
    setDiscarding(true);
    try {
      await deleteDraft();
      router.replace("/", { scroll: false });
      router.refresh();
    } finally {
      setDiscarding(false);
      setConfirmingDiscard(false);
    }
  }

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
  const copyFirstDayToAll = () =>
    setForm((f) => {
      const { opensAt, closesAt, isClosed } = f.hours.find((h) => h.dayOfWeek === HOURS_DISPLAY_ORDER[0])!;
      return { ...f, hours: f.hours.map((h) => ({ ...h, opensAt, closesAt, isClosed })) };
    });

  const removeAt = <T,>(arr: T[], i: number) => arr.filter((_, idx) => idx !== i);

  async function runImport() {
    if (importing) return;
    const url = normalizeImportUrl(importUrl);
    if (!url) {
      setImportError(t.storeImport.invalidUrl);
      return;
    }
    setImporting(true);
    setImportError("");
    setImportNotice("");
    try {
      const res = await fetch("/api/store-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportError(json?.error?.message ?? t.storeImport.failed);
        return;
      }
      const response = json as StoreImportResponse;
      const snapshot: ImportSnapshot = { url, fields: response.fields };
      // A re-fetch of the same link is reduced to what the PAGE changed since last time. Warnings
      // are dropped with it: "3 services had no stated duration" would be about services already
      // imported, not about anything new.
      const previous = lastImport.current?.url === url ? lastImport.current.fields : null;
      const offered = previous ? diffImportedFields(previous, response.fields) : response.fields;
      const warnings = previous ? [] : response.warnings;
      // A saved store's phone is locked (the backend answers 409 PHONE_LOCKED), so don't offer it.
      const items = buildImportItems(form, offered, { phoneLocked: mode === "edit" && !!initial?.phoneNumber });
      // The first fetch into a still-empty create form has nothing to protect: every row only fills
      // a gap, so asking the admin to tick them is pure friction. Apply the lot — silently. There is
      // no "Filled in N items" banner and no warnings box: whether the page gave 2 fields or 15, the
      // admin just sees the form filled, and Save is still theirs to press. (A blank duration is not
      // announced here; Save names each service that still needs one.) Only "nothing found" is said,
      // because a fetch that visibly does nothing reads as a broken button.
      // Anything else (an edit, a form with typed data, a second fetch) keeps the review dialog.
      if (mode === "create" && !hasImported.current && isPristineCreate(form)) {
        if (items.length === 0) {
          setImportNotice(t.storeImport.nothingNew);
        } else {
          applyImportFields(offered, new Set(items.map((i) => i.key)), snapshot);
        }
        return;
      }
      if (items.length === 0 && previous) {
        // Nothing to review — say why, rather than opening an empty dialog. The page is now known
        // to be in this state, so the next fetch diffs against it.
        setImportNotice(t.storeImport.nothingChanged);
        lastImport.current = snapshot;
        return;
      }
      setImportReview({ response: { ...response, fields: offered, warnings }, items, changesOnly: !!previous, snapshot });
    } catch {
      setImportError(t.storeImport.unreachable);
    } finally {
      setImporting(false);
    }
  }

  function applyImportFields(fields: ImportedFields, selected: Set<ImportKey>, snapshot: ImportSnapshot) {
    setForm((f) => {
      const next = applyImport(f, fields, selected);
      // Same rule as the category <select>: suggest a theme preset for a NEW store, until the admin
      // has picked one by hand.
      if (selected.has("category") && fields.category && mode === "create" && !presetTouched.current) {
        next.theme = { ...next.theme, preset: presetForCategory(fields.category) };
      }
      return next;
    });
    if (selected.has("phone") && fields.countryCode) {
      setPhoneIso2(countryByDial(fields.countryCode)?.iso2 ?? DEFAULT_ISO2);
    }
    hasImported.current = true;
    // Recorded on APPLY, not on fetch: a dialog the admin cancelled applied nothing, so the next
    // fetch should still offer those values rather than treat them as already seen.
    lastImport.current = snapshot;
  }

  function applyImportSelection(selected: Set<ImportKey>) {
    if (!importReview) return;
    applyImportFields(importReview.response.fields, selected, importReview.snapshot);
    setImportReview(null);
  }

  async function resetOwnerPassword() {
    if (!storeId || resettingOwnerPassword) return;
    setOwnerResetError("");
    setOwnerResetNotice("");
    if (newOwnerPassword.length < 6) {
      setOwnerResetError(t.storeForm.resetOwnerPasswordTooShort);
      return;
    }
    setResettingOwnerPassword(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/owner/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: newOwnerPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOwnerResetError(json?.error?.message ?? t.storeForm.resetOwnerPasswordErr);
        return;
      }
      setNewOwnerPassword("");
      setOwnerResetNotice(t.storeForm.resetOwnerPasswordDone);
    } catch {
      setOwnerResetError(t.storeForm.resetOwnerPasswordErr);
    } finally {
      setResettingOwnerPassword(false);
    }
  }

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
    // A service's duration is still required (it sizes every slot and wait estimate), but it is
    // never guessed: an imported service with no stated time arrives blank, so name it here rather
    // than let the API answer with a bare "Number must be greater than or equal to 1".
    const noDuration = form.services.filter((s) => s.name.trim() && !(Number(s.durationMinutes) >= 1));
    if (missing.length > 0 || noDuration.length > 0) {
      setError(t.storeForm.fillRequired);
      setDetails([
        ...missing.map((f) => ({ field: f.label, message: t.storeForm.fieldRequired })),
        ...noDuration.map((s) => ({
          field: format(t.storeForm.serviceDurationField, { name: s.name.trim() }),
          message: t.storeForm.durationRequired,
        })),
      ]);
      setSaving(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const badCommission = form.staff.filter(
      (s) => s.name.trim() && (s.commissionPercent ?? "").trim() && parseCommissionPercent(s.commissionPercent) == null,
    );
    if (badCommission.length > 0) {
      setError(t.storeForm.fillRequired);
      setDetails(
        badCommission.map((s) => ({
          field: format(t.storeForm.staffCommissionField, { name: s.name.trim() }),
          message: t.storeForm.staffCommissionInvalid,
        })),
      );
      setSaving(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (!/^#[0-9A-Fa-f]{6}$/.test(form.themeColor.trim())) {
      setError(t.storeForm.fillRequired);
      setDetails([{ field: t.storeForm.reqThemeColor, message: t.storeForm.invalidThemeColor }]);
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
      if (mode === "create") {
        // The draft has become a real store. Only now (never on a failed create, where the admin
        // still needs it) is it removed; deleteDraft also silences any autosave still in flight.
        await deleteDraft();
        // Land the admin straight on the new store's settings rather than leaving them on the
        // blank create form — they almost always have more to configure (hours, photos, etc.).
        router.push(`/stores/${(json as StoreMutationResult).id}/settings`);
        return;
      }
      setResult(json as StoreMutationResult);
      setSavedTheme(form.theme); // the appearance is now what's live — clear the unsaved flag
      router.refresh(); // update the sidebar list (new/renamed store)
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.storeForm.somethingWrong);
    } finally {
      setSaving(false);
    }
  }

  const previewUrl = useMemo(
    () => (result && FRONTEND_URL ? `${FRONTEND_URL}${result.micrositePath}` : ""),
    [result],
  );

  // Categories may not include the store's current value (e.g. a deactivated category on edit);
  // keep it selectable so a save doesn't silently drop it.
  const categoryOptions = useMemo(() => {
    const names = categories.map((c) => c.name);
    return form.category && !names.includes(form.category) ? [form.category, ...names] : names;
  }, [categories, form.category]);

  // What the number alone would pick — shown on the "Automatic" option so the admin sees the guess
  // before saving. An off-list stored zone stays selectable, same as currency below.
  const autoTimezone = timezoneForPhone(form.countryCode, form.phoneNumber);
  const timezoneOptions = useMemo(() => {
    return form.timezone && !TIMEZONE_OPTIONS.some((z) => z.value === form.timezone)
      ? [{ value: form.timezone, label: form.timezone }, ...TIMEZONE_OPTIONS]
      : TIMEZONE_OPTIONS;
  }, [form.timezone]);
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

      {mode === "create" && draftId && (
        <div className="draft-banner" role="status">
          <span>{t.storeDraft.banner}</span>
          <span className={`draft-status ${draftStatus}`} aria-live="polite">
            {draftStatus === "saving"
              ? t.storeDraft.autosaving
              : draftStatus === "saved"
                ? draftSavedAt
                  ? format(t.storeDraft.savedAt, {
                      time: draftSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    })
                  : t.storeDraft.saved
                : draftStatus === "error"
                  ? draftError
                  : ""}
          </span>
          <button type="button" className="btn-ghost" onClick={() => setConfirmingDiscard(true)}>
            {t.storeDraft.discard}
          </button>
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

      {/* Autofill from a link — deliberately OUTSIDE the <form>, so Enter in the URL box can never
          submit (and so create/save) the store. */}
      <section className="section import-card-form">
        <h2>{t.storeImport.title}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t.storeImport.hint}
        </p>
        <div className="import-row-inputs">
          <input
            aria-label={t.storeImport.urlLabel}
            type="url"
            inputMode="url"
            placeholder={t.storeImport.urlPlaceholder}
            value={importUrl}
            maxLength={2048}
            disabled={importing}
            onChange={(e) => {
              setImportUrl(e.target.value);
              if (importError) setImportError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runImport();
              }
            }}
          />
          <button type="button" className="btn-primary" onClick={() => void runImport()} disabled={importing || !importUrl.trim()} aria-busy={importing || undefined}>
            {importing && <Spinner className="btn-spinner" />}
            {importing ? t.storeImport.working : t.storeImport.button}
          </button>
        </div>
        {importError && (
          <p className="import-err" role="alert">
            {importError}
          </p>
        )}
        {importNotice && (
          <div className="alert info" role="status" style={{ marginTop: 12, marginBottom: 0 }}>
            {importNotice}
          </div>
        )}
      </section>

      {confirmingDiscard && (
        <ConfirmDialog
          title={t.storeDraft.discardTitle}
          body={t.storeDraft.discardBody}
          confirmLabel={t.storeDraft.discard}
          danger
          busy={discarding}
          onConfirm={() => void confirmDiscardDraft()}
          onCancel={() => setConfirmingDiscard(false)}
        />
      )}

      {importReview && (
        <StoreImportReview
          source={importReview.response.source.title || importReview.response.source.url}
          items={importReview.items}
          changesOnly={importReview.changesOnly}
          warnings={importReview.response.warnings}
          onApply={applyImportSelection}
          onCancel={() => setImportReview(null)}
        />
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
              <select id="sf-category" value={form.category} onChange={(e) => setCategory(e.target.value)} required>
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
              <label htmlFor="sf-timezone">{t.storeForm.timezone}</label>
              <select id="sf-timezone" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                <option value="">
                  {autoTimezone
                    ? format(t.storeForm.timezoneAuto, { zone: autoTimezone })
                    : t.storeForm.timezoneAutoUnknown}
                </option>
                {timezoneOptions.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </select>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t.storeForm.timezoneHint}</p>
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

        {/* Social links ------------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.socialTitle}</h2>
          <p className="hint">{t.storeForm.socialHint}</p>
          <div className="grid">
            {SOCIAL_FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`sf-${f.key}`}>{t.storeForm[f.key]}</label>
                <input
                  id={`sf-${f.key}`}
                  type="url"
                  inputMode="url"
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
            {/* Not a social icon — never shown on the microsite. It is where the post-visit
                review text points; the text is not sent while this is empty. */}
            <div className="field">
              <label htmlFor="sf-googleReviewUrl">{t.storeForm.googleReviewUrl}</label>
              <input
                id="sf-googleReviewUrl"
                type="url"
                inputMode="url"
                placeholder="https://g.page/r/your-place-id/review"
                value={form.googleReviewUrl}
                onChange={(e) => set("googleReviewUrl", e.target.value)}
              />
              <p className="hint">{t.storeForm.googleReviewUrlHint}</p>
            </div>
          </div>
        </section>

        {/* Appearance (replaces the old single "Theme color" field) ----- */}
        <AppearancePanel
          theme={form.theme}
          onChange={setTheme}
          category={form.category}
          phoneFull={phoneFull}
          savedTheme={savedTheme}
        />

        {/* Contact / phone ---------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.phoneSection}</h2>
          <PhoneField
            id="store-phone"
            label={t.storeForm.phoneLabel}
            required
            // Locked once the store exists: the number is its web address and is baked into every
            // printed QR code. The API refuses a change too (PHONE_LOCKED), so this is not the guard.
            disabled={mode === "edit" && !!initial?.phoneNumber}
            hint={
              mode === "edit" && initial?.phoneNumber ? <p className="hint">{t.storeForm.phoneLockedHint}</p> : undefined
            }
            value={{ dialCode: form.countryCode, national: form.phoneNumber, iso2: phoneIso2 }}
            onChange={(v) => {
              set("countryCode", v.dialCode);
              set("phoneNumber", v.national);
              setPhoneIso2(v.iso2);
            }}
          />
          <p className="hint">
            {t.storeForm.liveUrl}{" "}
            <code>
              {FRONTEND_URL ? `${FRONTEND_URL}/` : ""}
              {phoneFull || "…"}
            </code>
          </p>
        </section>

        {/* Hours -------------------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.weeklyHours}</h2>
          <button type="button" className="btn-add hours-copy-all" onClick={copyFirstDayToAll}>
            {t.storeForm.copyToAllDays}
          </button>
          {HOURS_DISPLAY_ORDER.map((dayOfWeek) => {
            const i = form.hours.findIndex((h) => h.dayOfWeek === dayOfWeek);
            const h = form.hours[i];
            return (
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
            );
          })}
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
          <ImageUpload
            label={t.storeForm.logoPhoto}
            assetType="logo"
            value={form.logoUrl}
            onChange={(url) => set("logoUrl", url)}
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
          <h2>{t.storeForm.servicesOptional}</h2>
          <p className="hint">{t.storeForm.servicesStaffOptionalHint}</p>
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
              {/* Fixed = one amount. Range = a band the customer sees, with the real figure
                  settled at checkout. No price = nothing is shown and the amount is typed at
                  checkout. Leaving Fixed clears any ceiling the row was carrying, because the API
                  refuses a fixed service that still has one; choosing No price also zeroes the
                  amount, since that is what the API stores for it. */}
              <div className="field">
                <label>{t.storeForm.priceMode}</label>
                <select
                  value={s.priceType}
                  onChange={(e) => {
                    const v = e.target.value;
                    const priceType = v === "range" || v === "unset" ? v : "fixed";
                    setService(i, {
                      priceType,
                      priceMaxRupees: priceType === "range" ? s.priceMaxRupees : null,
                      ...(priceType === "unset" ? { priceRupees: 0 } : {}),
                    });
                  }}
                >
                  <option value="fixed">{t.storeForm.priceModeFixed}</option>
                  <option value="range">{t.storeForm.priceModeRange}</option>
                  <option value="unset">{t.storeForm.priceModeNone}</option>
                </select>
              </div>
              {s.priceType === "unset" ? (
                <div className="field" aria-hidden />
              ) : (
                <div className="field">
                  <label>
                    {format(s.priceType === "range" ? t.storeForm.priceMin : t.storeForm.price, {
                      symbol: currencySymbol(form.currency),
                    })}
                  </label>
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
              )}
              {/* The placeholder keeps the grid columns aligned across rows in different modes —
                  without it a fixed row and a range row below it stagger. */}
              {s.priceType === "range" ? (
                <div className="field">
                  <label>{format(t.storeForm.priceMax, { symbol: currencySymbol(form.currency) })}</label>
                  <input
                    value={s.priceMaxRupees || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") return setService(i, { priceMaxRupees: null });
                      const n = Number(v);
                      if (!Number.isNaN(n)) setService(i, { priceMaxRupees: n });
                    }}
                    inputMode="numeric"
                  />
                </div>
              ) : (
                <div className="field" aria-hidden />
              )}
              <button type="button" className="btn-remove" onClick={() => set("services", removeAt(form.services, i))}>
                {t.common.remove}
              </button>
              {s.priceType === "unset" && (
                <p className="hint" style={{ gridColumn: "1 / -1", margin: 0 }}>
                  {t.storeForm.priceUnsetHint}
                </p>
              )}
            </div>
          ))}
          <p className="hint" style={{ marginTop: 0 }}>
            {t.storeForm.priceRangeHint}
          </p>
          <button
            type="button"
            className="btn-add"
            onClick={() =>
              set("services", [
                ...form.services,
                { name: "", durationMinutes: 30, priceRupees: 0, priceType: "fixed" as const, priceMaxRupees: null },
              ])
            }
          >
            {t.storeForm.addService}
          </button>
        </section>

        {/* Staff -------------------------------------------------------- */}
        <section className="section">
          <h2>{t.storeForm.staffOptional}</h2>
          <p className="hint">{t.storeForm.servicesStaffOptionalHint}</p>
          <p className="hint">{t.storeForm.staffCommissionHint}</p>
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
              <div className="field">
                <label>{t.storeForm.staffCommission}</label>
                <input
                  value={s.commissionPercent ?? ""}
                  onChange={(e) => setStaff(i, { commissionPercent: e.target.value })}
                  placeholder={t.storeForm.staffCommissionPlaceholder}
                  inputMode="decimal"
                />
              </div>
              <button type="button" className="btn-remove" onClick={() => set("staff", removeAt(form.staff, i))}>
                {t.common.remove}
              </button>
              <ImageUpload label={t.storeForm.staffPhoto} assetType="avatar" value={s.avatarUrl} onChange={(url) => setStaff(i, { avatarUrl: url })} />
            </div>
          ))}
          <button
            type="button"
            className="btn-add"
            onClick={() => set("staff", [...form.staff, { name: "", roleLabel: "", avatarUrl: "", commissionPercent: "" }])}
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
                <input
                  id="sf-ownerPhone"
                  value={form.ownerPhone}
                  onChange={(e) => set("ownerPhone", e.target.value.replace(/\D/g, ""))}
                  placeholder={phoneFull}
                  inputMode="numeric"
                />
                <p className="hint">{t.storeForm.ownerPhoneHint}</p>
              </div>
              <div className="field">
                <label htmlFor="sf-ownerPassword">{t.storeForm.password}</label>
                <input id="sf-ownerPassword" type="text" value={form.ownerPassword} onChange={(e) => set("ownerPassword", e.target.value)} minLength={6} required />
                {draftId && <p className="hint">{t.storeDraft.passwordNotSaved}</p>}
              </div>
            </div>
          </section>
        )}

        {/* Owner login reset (edit only) -------------------------------- */}
        {mode === "edit" && (
          <section className="section">
            <h2>{t.storeForm.ownerLogin}</h2>
            <p className="hint">{t.storeForm.ownerLoginResetHint}</p>
            {ownerResetError ? (
              <div className="alert err" role="alert">
                {ownerResetError}
              </div>
            ) : null}
            {ownerResetNotice ? (
              <div className="alert ok" role="status">
                {ownerResetNotice}
              </div>
            ) : null}
            <div className="grid">
              <div className="field">
                <label htmlFor="sf-ownerPhoneReadonly">{t.storeForm.ownerPhone}</label>
                <input id="sf-ownerPhoneReadonly" value={form.ownerPhone || t.common.dash} readOnly />
              </div>
              <div className="field">
                <label htmlFor="sf-newOwnerPassword">{t.storeForm.newPassword}</label>
                <div className="password-field">
                  <input
                    id="sf-newOwnerPassword"
                    type={showOwnerPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={t.storeForm.newPasswordPlaceholder}
                    value={newOwnerPassword}
                    onChange={(e) => setNewOwnerPassword(e.target.value)}
                    minLength={6}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowOwnerPassword((s) => !s)}
                    aria-label={showOwnerPassword ? t.login.hidePassword : t.login.showPassword}
                    aria-pressed={showOwnerPassword}
                    tabIndex={-1}
                  >
                    <Icon name={showOwnerPassword ? "eyeOff" : "eye"} size={18} />
                  </button>
                </div>
                <p className="hint">{t.storeForm.newPasswordHint}</p>
              </div>
            </div>
            <button
              type="button"
              className="btn-ghost"
              disabled={resettingOwnerPassword || !newOwnerPassword.trim()}
              aria-busy={resettingOwnerPassword || undefined}
              onClick={() => void resetOwnerPassword()}
            >
              {resettingOwnerPassword && <Spinner className="btn-spinner" />}
              {resettingOwnerPassword ? t.storeForm.resetOwnerPasswordBusy : t.storeForm.resetOwnerPassword}
            </button>
          </section>
        )}

        <div className="actions">
          <button type="submit" className="btn-primary" disabled={saving} aria-busy={saving || undefined}>
            {saving && <Spinner className="btn-spinner" />}
            {saving ? t.storeForm.saving : mode === "create" ? t.storeForm.createStore : t.storeForm.saveChanges}
          </button>
          {mode === "create" && (
            <button
              type="button"
              className="btn-ghost"
              disabled={saving || draftBusy}
              aria-busy={draftBusy || undefined}
              onClick={() => void saveAsDraft()}
            >
              {draftBusy && <Spinner className="btn-spinner" />}
              {draftBusy ? t.storeDraft.savingDraft : t.storeDraft.saveAsDraft}
            </button>
          )}
          {saving && <span className="hint">{t.storeForm.workingHint}</span>}
        </div>
      </form>
    </div>
  );
}
