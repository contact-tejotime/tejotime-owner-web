import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";

export function AppPageHeader({
  title,
  subtitle,
  avatar,
  action,
  settingsHref = "/settings",
  showSettings = true,
}: {
  title: string;
  subtitle?: string;
  avatar?: string;
  action?: ReactNode;
  settingsHref?: string;
  showSettings?: boolean;
}) {
  return (
    <header className="app-header">
      <div className="app-header-left">
        {avatar ? (
          <div className="home-avatar" aria-hidden>
            {avatar}
          </div>
        ) : null}
        <div className="app-header-text">
          <h1 className="app-header-title">{title}</h1>
          {subtitle ? <p className="app-header-sub">{subtitle}</p> : null}
        </div>
      </div>
      <div className="app-header-actions">
        {action}
        {showSettings ? (
          <Link href={settingsHref} className="icon-btn" aria-label="Settings">
            <Icon name="settings" size={20} />
          </Link>
        ) : null}
      </div>
    </header>
  );
}
