/**
 * Appearance-panel copy — now sourced from `@/i18n` like the rest of the app.
 *
 * This module predates owner-web's i18n setup and shipped its own private dictionary. The
 * strings have moved to `src/i18n/en.json` (`appearance` + `storeForm.invalidThemeColor`);
 * everything here is a re-export so the existing call sites keep working unchanged.
 */
import { t as dictionary, format } from "@/i18n";

export const t = dictionary;

/** @deprecated Prefer `t.appearance`. */
export const appearanceCopy = dictionary.appearance;

/** @deprecated Prefer `format` from `@/i18n`. */
export const formatAppearance = format;
