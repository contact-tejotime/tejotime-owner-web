"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Spinner } from "@/components/Skeleton";
import { frontendUrl } from "@/lib/frontend-url";
import type { BusinessDetail } from "@/lib/server-api";
import { showToast } from "@/lib/toast";
import { LEGACY_THEME_CONFIG, normalizeThemeConfig, type ThemeConfig } from "@/theme/engine";
import AppearancePanel, { key, resetToRecommended } from "./AppearancePanel";
import { t } from "./appearanceCopy";

/**
 * Settings → Appearance: the app's settings/appearance.tsx on the web — the panel's controls, then
 * Reset to recommended, Open customer site and Save appearance.
 *
 * This was a section at the bottom of the store profile, saved by the profile's button. The app
 * made it its own screen, and so does this: the theme is saved on its own as ONE whole object
 * (`PATCH /business { theme }`). Sending a partial theme is how a store ends up with a colour its
 * microsite ignores — the backend dual-writes `theme.brand` into the legacy `theme_color` column
 * from the full object.
 *
 * After a save the page refreshes, which re-renders owner-web's own chrome in the new theme (it
 * wears the store's colours, as the app does), the same moment the app re-themes itself.
 */

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export interface AppearanceSource {
  /** As stored — every key optional, possibly from an older schema; normalised on the way in. */
  theme: BusinessDetail["theme"];
  themeColor: string | null;
  category: string | null;
  countryCode: string | null;
  phoneNumber: string | null;
}

/** The stored config, or the legacy colour for a store saved before themes existed. */
function themeFromBusiness(b: AppearanceSource): ThemeConfig {
  const legacyBrand =
    typeof b.themeColor === "string" && HEX_RE.test(b.themeColor) ? b.themeColor.toUpperCase() : "#2563EB";
  return normalizeThemeConfig(b.theme, { ...LEGACY_THEME_CONFIG, brand: legacyBrand });
}

export function AppearanceEditor({ business }: { business: AppearanceSource }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [theme, setTheme] = useState<ThemeConfig>(() => themeFromBusiness(business));
  const [saved, setSaved] = useState<ThemeConfig>(() => themeFromBusiness(business));
  const [inFlight, setInFlight] = useState(false);
  const busy = inFlight || isPending;

  const category = business.category ?? "";
  const phoneFull = `${business.countryCode ?? ""}${business.phoneNumber ?? ""}`.replace(/\D/g, "");
  const siteBase = frontendUrl();
  const siteUrl = siteBase && /^\d{7,15}$/.test(phoneFull) ? `${siteBase}/${phoneFull}` : "";

  const dirty = key(theme) !== key(saved);
  const brandValid = HEX_RE.test(theme.brand.trim());
  const buttonValid = theme.button === undefined || HEX_RE.test(theme.button.trim());

  async function save() {
    if (!brandValid || !buttonValid) {
      showToast(t.storeForm.invalidThemeColor, "error");
      return;
    }
    setInFlight(true);
    try {
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        showToast(json?.error?.message ?? t.appearance.errSave, "error");
        return;
      }
      setSaved(structuredClone(theme));
      showToast(t.appearance.toastSaved, "success");
      startTransition(() => router.refresh());
    } catch {
      showToast(t.profile.networkError, "error");
    } finally {
      setInFlight(false);
    }
  }

  return (
    <div className="sb-ap">
      <AppearancePanel
        theme={theme}
        onChange={setTheme}
        category={category}
        phoneFull={phoneFull}
        savedTheme={saved}
      />

      <div className="sb-savebar">
        {/* The top "Unsaved changes" line is the app's; this one keeps the state in view while the
            bar is pinned on a larger screen, and is hidden on a phone (settings-b.css). */}
        <span className={`sb-savebar-note${dirty ? " is-dirty" : ""}`} role="status">
          {dirty ? t.appearance.unsaved : t.appearance.saved}
        </span>
        <div className="sb-savebar-btns">
          <button
            type="button"
            className="sb-btn sb-btn--secondary sb-btn--block"
            onClick={() => setTheme(resetToRecommended(theme, category))}
            title={t.appearance.resetHint}
          >
            {t.appearance.reset}
          </button>
          {siteUrl ? (
            <a className="sb-btn sb-btn--secondary sb-btn--block" href={siteUrl} target="_blank" rel="noreferrer">
              {t.appearance.openSite}
            </a>
          ) : (
            <button
              type="button"
              className="sb-btn sb-btn--secondary sb-btn--block"
              onClick={() => showToast(t.appearance.openSiteMissing, "error")}
            >
              {t.appearance.openSite}
            </button>
          )}
          <button
            type="button"
            className="sb-btn sb-btn--primary sb-btn--lg sb-btn--block"
            onClick={save}
            disabled={busy || !dirty || !brandValid || !buttonValid}
          >
            {busy ? <Spinner size={16} /> : null}
            {t.appearance.save}
          </button>
        </div>
      </div>
    </div>
  );
}
