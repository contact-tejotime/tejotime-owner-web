import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/i18n";
import { Icon } from "@/components/Icon";
import "@/styles/shell-sheets.css";

/**
 * A settings sub-page's header — the web twin of the app's `SettingsPageShell` header: a soft
 * back button, the title centred in bold, and a blank the width of the button on the right so the
 * title stays centred between them. The subtitle, which the app does not have, becomes a muted
 * lead line under the row rather than crowding it.
 *
 * Drawn to match `SettingsSubpageShell` (the Hours / Team / Notifications / Password chrome)
 * exactly, so the Settings section reads as one design whichever of the two a page uses.
 *
 * `backHref` defaults to /settings because every current caller lives there, and without it a
 * phone had no way back but the bottom nav — the app has always had the chevron. It is a link,
 * not `history.back()`: a tab opened straight onto a sub-page has no history to go back through.
 * Pass `null` to drop it.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  backHref = "/settings",
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Where the back button goes. `null` hides it (and its balancing blank). */
  backHref?: string | null;
}) {
  return (
    <>
      <div className="sub-head">
        {backHref ? (
          <Link href={backHref} className="sub-head-back" aria-label={t.common.back}>
            <Icon name="chevronLeft" size={22} />
          </Link>
        ) : null}
        <h1 className={`sub-head-title${backHref ? "" : " is-start"}`}>{title}</h1>
        {actions ? (
          <div className="sub-head-actions">{actions}</div>
        ) : backHref ? (
          <span className="sub-head-spacer" aria-hidden />
        ) : null}
      </div>
      {subtitle ? <p className="sub-head-lead">{subtitle}</p> : null}
    </>
  );
}
