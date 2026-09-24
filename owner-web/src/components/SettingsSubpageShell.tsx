import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/i18n";

import { Icon } from "@/components/Icon";
import { Skeleton, SkeletonScreen } from "@/components/Skeleton";
import "@/styles/settings-a.css";

type ShellWidth = "default" | "narrow" | "wide";

const widthClass = (width: ShellWidth) => (width === "default" ? "" : ` sa-page--${width}`);

/**
 * Chrome for every Settings sub-page (Working hours, Team logins, Notifications, Your account, and
 * settings-b's Profile / Services / Staff / Appearance) — the web twin of the app's
 * `SettingsPageShell`: a soft back button, the title centred, and a spacer the width of the back
 * button so the title stays centred between them. Shared, so a change here moves all of them.
 *
 * The back button is a link to /settings rather than `history.back()`. The app can always pop to
 * the Settings tab; a browser tab opened straight onto /settings/hours has no history to pop, and
 * "back" would leave the portal.
 *
 * `width` picks the column: `narrow` for one short form, `wide` for the team grid, the default
 * 720px for a list card. The same shell is drawn at every width — a tablet or a monitor gets a
 * capped column, never a different header.
 */
export function SettingsSubpageShell({
  title,
  width = "default",
  children,
}: {
  title: string;
  width?: ShellWidth;
  children: ReactNode;
}) {
  return (
    <div className={`sa-page${widthClass(width)}`}>
      <header className="sa-head">
        <Link href="/settings" className="sa-back" aria-label={t.settingsSubpage.back}>
          <Icon name="chevronLeft" size={22} />
        </Link>
        <h1 className="sa-title">{title}</h1>
        <span className="sa-head-spacer" aria-hidden />
      </header>
      {children}
    </div>
  );
}

/**
 * Route-level loading state for the same pages, sketched in the shell's own layout so the page
 * lands without a jump: `rows` is a list card (hours, notifications), `cards` the team grid.
 */
export function SettingsSubpageSkeleton({
  kind,
  rows = 4,
  width = "default",
}: {
  kind: "rows" | "cards";
  rows?: number;
  width?: ShellWidth;
}) {
  return (
    <SkeletonScreen label={t.loading.settings}>
      <div className={`sa-page${widthClass(width)}`}>
        <div className="sa-head">
          <Skeleton width={40} height={40} radius={10} />
          <span className="sa-title">
            <Skeleton width={140} height={20} className="sa-skel-center" />
          </span>
          <span className="sa-head-spacer" />
        </div>

        {kind === "rows" ? (
          <div className="sa-card">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="sa-skel-row">
                <Skeleton width="42%" height={15} />
                <Skeleton width={42} height={24} radius={999} />
              </div>
            ))}
          </div>
        ) : null}

        {kind === "cards" ? (
          <>
            <Skeleton width="60%" height={13} className="sa-skel-lead" />
            <div className="sa-team-grid">
              {Array.from({ length: rows }, (_, i) => (
                <Skeleton key={i} height={132} radius={12} />
              ))}
            </div>
          </>
        ) : null}

      </div>
    </SkeletonScreen>
  );
}
