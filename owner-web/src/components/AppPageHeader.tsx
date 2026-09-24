import Link from "next/link";
import { t } from "@/i18n";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { StoreMark } from "@/components/StoreMark";
import "@/styles/shell-sheets.css";

/**
 * A tab's page header — the web twin of the app's `THeader`: optional store mark, a 22px
 * extra-bold title with its subtitle under it, and an optional action on the right.
 *
 * The settings gear is web-only. Below 1025px it is hidden, because the bottom nav's Settings tab
 * is on screen right under the thumb and the app's header never carries one; on desktop it stays
 * as a shortcut beside the sidebar. `showSettings` still turns it off everywhere.
 */
export function AppPageHeader({
  title,
  subtitle,
  avatar,
  avatarName,
  avatarUrl,
  action,
  settingsHref = "/settings",
  showSettings = true,
}: {
  title: string;
  subtitle?: string;
  /** Initials drawn as the store mark (a solid brand tile), as the app's THeader `avatar` does. */
  avatar?: string;
  /** The store's name — the initials fallback if `avatarUrl` fails to load. Defaults to `title`. */
  avatarName?: string;
  /** The store's uploaded logo, shown in place of the initials tile when present. */
  avatarUrl?: string | null;
  action?: ReactNode;
  settingsHref?: string;
  showSettings?: boolean;
}) {
  return (
    <header className="app-header">
      <div className="app-header-left">
        {avatarUrl ? (
          <StoreMark name={avatarName ?? title} logoUrl={avatarUrl} />
        ) : avatar ? (
          // The same solid brand tile as Home's StoreMark. It used to be a pale tint behind
          // brand-tinted initials, which all but vanished on a warm preset.
          <span className="store-mark" aria-hidden>
            {avatar}
          </span>
        ) : null}
        <div className="app-header-text">
          <h1 className="app-header-title">{title}</h1>
          {subtitle ? <p className="app-header-sub">{subtitle}</p> : null}
        </div>
      </div>
      <div className="app-header-actions">
        {action}
        {showSettings ? (
          <Link href={settingsHref} className="icon-btn app-header-settings" aria-label={t.common.settings}>
            <Icon name="settings" size={20} />
          </Link>
        ) : null}
      </div>
    </header>
  );
}
