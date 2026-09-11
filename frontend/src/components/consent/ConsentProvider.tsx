"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  CONSENT_VERSION,
  DEFAULT_CATEGORIES,
  categoriesOf,
  clearAnalyticsCookies,
  isCurrent,
  readConsent,
  writeConsent,
  type ConsentCategories,
  type ConsentRecord,
} from "@/lib/consent";
import { initConsentModeDefaults, loadAnalyticsIfAllowed, updateConsentMode } from "@/lib/consentMode";
import { publicApi } from "@/lib/api";
import { CookieBanner } from "./CookieBanner";
import { CookiePreferencesModal } from "./CookiePreferencesModal";

/**
 * Owns consent state for the whole site, and renders the banner and the modal.
 *
 * HYDRATION. The cookie is browser-only state, so it is read through `useSyncExternalStore`
 * rather than in an effect. The server snapshot is the `UNRESOLVED` sentinel, which renders no
 * consent markup at all; React re-reads the real snapshot right after hydration. That gives
 * three things at once: server HTML and first client render are byte-identical (no hydration
 * warning), no banner can flash for a visitor who already answered, and `document.cookie` is
 * never touched during render.
 *
 * Consent Mode's denied defaults are pushed on mount, before anything else could queue a tag.
 */

interface ConsentContextValue {
  /** The visitor's current categories. Defaults (all optional off) until they choose. */
  consent: ConsentCategories;
  /** True once a *current-version* choice exists. Drives whether the banner shows. */
  hasResponded: boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  openPreferences: () => void;
  closePreferences: () => void;
  savePreferences: (categories: Omit<ConsentCategories, "necessary">) => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used inside <ConsentProvider>");
  return ctx;
}

/* ----------------------------------------------------------------- the store -- */

/**
 * A cookie emits no change event, and this app is the only writer, so the "external store" is a
 * one-entry cache plus a listener set. Snapshots must be referentially STABLE — returning a
 * fresh object from `getSnapshot` would re-render forever — hence the cached `current`.
 */
type Snapshot = { resolved: false; record: null } | { resolved: true; record: ConsentRecord | null };

const UNRESOLVED: Snapshot = { resolved: false, record: null };

let current: Snapshot | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): Snapshot {
  // Lazy, so the cookie is read once per page load rather than on every render.
  if (current === null) current = { resolved: true, record: readConsent() };
  return current;
}

/** Server (and the hydrating render) sees "not yet known", so nothing consent-related renders. */
function getServerSnapshot(): Snapshot {
  return UNRESOLVED;
}

function publish(record: ConsentRecord | null): void {
  current = { resolved: true, record };
  for (const listener of listeners) listener();
}

/* -------------------------------------------------------------------- provider -- */

const ALL_ON = { analytics: true, marketing: true, preferences: true };
const ALL_OFF = { analytics: false, marketing: false, preferences: false };

export function ConsentProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { resolved, record } = snapshot;

  const [modalOpen, setModalOpen] = useState(false);
  /** The element to restore focus to when the modal closes (WCAG 2.4.3). */
  const openerRef = useRef<HTMLElement | null>(null);

  // Denied defaults go out on every page load, whatever the stored answer is; a still-valid
  // choice is then re-applied so Consent Mode and any analytics tag reflect it after a reload.
  useEffect(() => {
    initConsentModeDefaults();
    const stored = readConsent();
    if (isCurrent(stored)) {
      const cats = categoriesOf(stored);
      updateConsentMode(cats);
      loadAnalyticsIfAllowed(cats);
    }
  }, []);

  const hasResponded = isCurrent(record);

  /**
   * Categories in force right now. A record whose `version` is stale does NOT count as a
   * response — the banner returns — but its answers are still what the modal pre-loads, so a
   * re-prompted visitor sees their previous choices rather than everything reset to off.
   */
  const consent = useMemo<ConsentCategories>(
    () => (hasResponded ? categoriesOf(record) : DEFAULT_CATEGORIES),
    [hasResponded, record],
  );

  /** What the modal shows: previous answers if any exist, defaults otherwise. */
  const initialToggles = useMemo<ConsentCategories>(() => categoriesOf(record), [record]);

  const commit = useCallback(
    (categories: Omit<ConsentCategories, "necessary">) => {
      const previous = record;
      const saved = writeConsent(categories);
      publish(saved);

      const cats = categoriesOf(saved);
      updateConsentMode(cats);

      // Withdrawal: turning analytics off after it was on must also remove what it set.
      // updateConsentMode() stops future collection; the existing _ga identifier would otherwise
      // survive the very consent that was just revoked.
      if (previous?.analytics && !cats.analytics) clearAnalyticsCookies();
      if (cats.analytics) loadAnalyticsIfAllowed(cats);

      // Fire-and-forget. Deliberately not awaited and deliberately swallowing every error: the
      // visitor's choice is already persisted in their own cookie, which is what governs
      // behaviour. The server copy is an audit record, and a failed audit write must never block
      // a click, surface an error, or keep the banner on screen.
      void publicApi
        .postConsent({
          visitorId: saved.visitorId,
          necessary: true,
          analytics: saved.analytics,
          marketing: saved.marketing,
          preferences: saved.preferences,
          timestamp: saved.timestamp,
          policyVersion: CONSENT_VERSION,
        })
        .catch(() => {});
    },
    [record],
  );

  const closePreferences = useCallback(() => {
    setModalOpen(false);
    // Return focus to whatever opened the modal, then forget it.
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener && typeof opener.focus === "function") {
      window.setTimeout(() => opener.focus(), 0);
    }
  }, []);

  const openPreferences = useCallback(() => {
    openerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    setModalOpen(true);
  }, []);

  const acceptAll = useCallback(() => {
    commit(ALL_ON);
    setModalOpen(false);
  }, [commit]);

  const rejectAll = useCallback(() => {
    commit(ALL_OFF);
    setModalOpen(false);
  }, [commit]);

  const savePreferences = useCallback(
    (categories: Omit<ConsentCategories, "necessary">) => {
      commit(categories);
      closePreferences();
    },
    [commit, closePreferences],
  );

  const value = useMemo<ConsentContextValue>(
    () => ({ consent, hasResponded, acceptAll, rejectAll, openPreferences, closePreferences, savePreferences }),
    [consent, hasResponded, acceptAll, rejectAll, openPreferences, closePreferences, savePreferences],
  );

  return (
    <ConsentContext.Provider value={value}>
      {/*
        The banner renders BEFORE `children` on purpose.

        It is `position: fixed`, so DOM order does not move it on screen — but it does decide
        where it lands in the tab sequence. Rendered last, a keyboard user had to tab through the
        entire landing page (60+ stops, measured) before reaching the consent buttons, even
        though the banner is the first thing on screen. Putting it first makes focus order match
        visual order, which is the whole point of WCAG 2.4.3.

        `resolved` is false on the server and during hydration, so nothing consent-related exists
        in the server HTML — which is what keeps the markup identical across hydration.
      */}
      {resolved && !hasResponded && !modalOpen && <CookieBanner />}
      {children}
      {resolved && modalOpen && (
        <CookiePreferencesModal
          initial={initialToggles}
          onSave={savePreferences}
          onRejectAll={rejectAll}
          onCancel={closePreferences}
        />
      )}
    </ConsentContext.Provider>
  );
}
