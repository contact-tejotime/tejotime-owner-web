"use client";

import "@/styles/settings-hub.css";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { t, format } from "@/i18n";
import { Icon, type IconName } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";
import { StoreBookingQr } from "@/components/StoreBookingQr";
import { StoreMark } from "@/components/StoreMark";
import { can, isOwnerRole, type ModuleAccess, type UserRole } from "@/lib/roles";
import type { ThemeConfig } from "@/lib/server-api";
import { SUPPORT } from "@/lib/support";
import { showToast } from "@/lib/toast";

type StoreMode = NonNullable<ThemeConfig["mode"]>;

/* ------------------------------------------------------------------ dark mode */

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The shell element that carries the store theme (`AppShell` → `storeThemeAttrs`). */
function shellRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".app[data-tt-theme]");
}

function readShellDark(): boolean {
  const mode = shellRoot()?.getAttribute("data-tt-mode");
  if (mode === "dark") return true;
  if (mode === "auto") return window.matchMedia(DARK_QUERY).matches;
  return false;
}

function subscribeShellMode(onChange: () => void): () => void {
  const root = shellRoot();
  const observer = new MutationObserver(onChange);
  if (root) observer.observe(root, { attributes: true, attributeFilter: ["data-tt-mode"] });
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

/**
 * The Dark mode switch, working the way the app's does (`app/src/theme/ThemeProvider.tsx`): the
 * store's Appearance mode decides until the owner flips it, then their choice wins for the
 * session — it has to keep working for a store whose Appearance is pinned to Light.
 *
 * It used to be a `useState(false)` that changed nothing but its own knob, and always started
 * "off", even on a store whose Appearance is Dark.
 *
 * The shell's theme CSS already has a dark block keyed on `data-tt-mode="dark"` on `.app`
 * (StoreThemeStyle), so the switch only flips that attribute. React leaves it alone on later
 * renders because AppShell's prop does not change, so the choice survives client navigation; a
 * full reload returns to the store's mode, as a relaunch does on the phone. Nothing persists it:
 * `app_user.dark_mode` is read by `/auth/me` but no endpoint writes it, on either surface.
 */
function useShellDark(storeMode: StoreMode): [boolean, (next: boolean) => void] {
  const dark = useSyncExternalStore(subscribeShellMode, readShellDark, () => storeMode === "dark");
  const setDark = (next: boolean) => shellRoot()?.setAttribute("data-tt-mode", next ? "dark" : "light");
  return [dark, setDark];
}

/* ----------------------------------------------------------------------- rows */

/** Icon tile + label/sub + chevron — the web twin of the app's `TSettingsRow`. */
function RowContent({
  icon,
  label,
  sub,
  trailing,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  /** Replaces the chevron (the Dark mode switch). */
  trailing?: ReactNode;
}) {
  return (
    <>
      <span className="st-row-icon" aria-hidden>
        <Icon name={icon} size={18} />
      </span>
      {/* The divider is on this box, not the row, so it starts after the icon — as on the app. */}
      <span className="st-row-body">
        <span className="st-row-text">
          <span className="st-row-label">{label}</span>
          {sub ? <span className="st-row-sub">{sub}</span> : null}
        </span>
        {trailing ?? <Icon name="chevronRight" size={18} className="st-row-chevron" />}
      </span>
    </>
  );
}

function SettingsRow({
  href,
  externalHref,
  icon,
  label,
  sub,
}: {
  href?: string;
  /** mailto: / tel: — rendered as a plain anchor, not a Next.js route. */
  externalHref?: string;
  icon: IconName;
  label: string;
  sub?: string;
}) {
  const body = <RowContent icon={icon} label={label} sub={sub} />;
  if (externalHref) {
    return (
      <a href={externalHref} className="st-row st-row-link">
        {body}
      </a>
    );
  }
  return (
    <Link href={href ?? "/settings"} className="st-row st-row-link">
      {body}
    </Link>
  );
}

/**
 * The app's "Booking QR code" row, which opens the QR sheet.
 *
 * The dialog is `StoreBookingQr` — the same one Home's live card opens — so there is one QR
 * dialog to maintain. Its trigger is drawn as a transparent button stretched over the whole row
 * (`.st-row-hit`), so the row is the click target and the dialog stays shared.
 */
function BookingQrRow({ cardUrl, storeName }: { cardUrl: string; storeName: string }) {
  return (
    <div className="st-row st-row-link st-row-qr">
      <RowContent icon="qrCode" label={t.settings.bookingQr} sub={t.settings.bookingQrSub} />
      <StoreBookingQr cardUrl={cardUrl} storeName={storeName} buttonClassName="st-row-hit" />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="st-group">
      <h2 className="st-group-title">{title}</h2>
      <div className="st-card">{children}</div>
    </section>
  );
}

/* --------------------------------------------------------------------- screen */

/**
 * Settings — the same six groups, rows, icons and wording as the app's Settings tab
 * (`app/src/app/(app)/(tabs)/settings.tsx`, docs/mobile-settings-screen.md). The grouping is the
 * product's, not the platform's: regroup both surfaces or neither.
 *
 * Every row is gated on the permission map from `/auth/me`. A staff member with only queue
 * access sees a settings screen with just their own account on it — the rows are not disabled,
 * they are absent, because a greyed-out "Subscription" row is an invitation to ask why.
 *
 * `Team logins` and `Appearance` are gated on the ROLE, not a permission, mirroring the backend
 * and the app: creating logins is the one thing an owner cannot delegate, because whoever can do
 * it can grant themselves everything else.
 *
 * Web-only, on purpose: the **Subscription** row (`billing`). The app must never show one — see
 * docs/mobile-no-in-app-purchases.md.
 */
export function SettingsScreen({
  role,
  access,
  storeName,
  logoUrl,
  userName,
  storeMode,
  cardUrl,
  subs,
}: {
  role: UserRole;
  access: ModuleAccess;
  storeName: string;
  logoUrl: string | null;
  /** The signed-in login's own name; null when the account has none. */
  userName: string | null;
  storeMode: StoreMode;
  /** The booking card URL for the QR, from the profile-gated `/business/qr`. */
  cardUrl: string | null;
  /** Live row subtitles, resolved on the server (see page.tsx). */
  subs: { profile: string; hours: string; services: string; staff: string };
}) {
  const router = useRouter();
  const [dark, setDark] = useShellDark(storeMode);
  const [signingOut, setSigningOut] = useState(false);

  const owner = isOwnerRole(role);
  const showBusiness =
    can(access, "profile") || can(access, "hours") || can(access, "services") || can(access, "staff");
  // The app gates the QR row on `profile`; here it also needs the card URL that read returns,
  // since there is nothing to encode without it.
  const showQr = can(access, "profile") && !!cardUrl;
  const showBookings = showQr || can(access, "notifications");

  async function onSignOut() {
    setSigningOut(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      // The route clears the cookies and answers 200 even when the backend is down; anything
      // else (a same-origin refusal) means the cookies are still set, and /login would bounce
      // straight back in. Say so and give the button back.
      if (!res.ok) {
        showToast(t.mutation.generic, "error");
        setSigningOut(false);
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      // The portal's own server was unreachable, so nothing was cleared either.
      showToast(t.mutation.networkError, "error");
      setSigningOut(false);
    }
  }

  return (
    <div className="page-app">
      <header className="st-head">
        <StoreMark name={storeName} logoUrl={logoUrl} />
        <div className="st-head-text">
          <h1 className="st-head-title">{t.settings.title}</h1>
          <p className="st-head-sub">{storeName}</p>
        </div>
      </header>

      {/* One column on a phone; the groups flow into columns from tablet up (settings-hub.css). */}
      <div className="st-columns">
        {showBusiness ? (
          <Group title={t.settings.groupBusiness}>
            {can(access, "profile") ? (
              <SettingsRow
                href="/settings/profile"
                icon="building"
                label={t.settings.businessProfile}
                sub={subs.profile}
              />
            ) : null}
            {/* Its own page, as on the app (`goTo('appearance')`). It used to be a section of the
                Business profile editor; lib/roles.ts gates the path on `profile`, and the page
                itself refuses anyone but an owner / co-owner — the same role gate as this row. */}
            {owner ? (
              <SettingsRow
                href="/settings/appearance"
                icon="sparklesStar"
                label={t.settings.appearance}
                sub={t.settings.appearanceSub}
              />
            ) : null}
            {can(access, "hours") ? (
              <SettingsRow href="/settings/hours" icon="clock" label={t.settings.workingHours} sub={subs.hours} />
            ) : null}
            {can(access, "services") ? (
              <SettingsRow href="/settings/services" icon="scissors" label={t.settings.services} sub={subs.services} />
            ) : null}
            {can(access, "staff") ? (
              <SettingsRow href="/settings/staff" icon="users" label={t.settings.staff} sub={subs.staff} />
            ) : null}
          </Group>
        ) : null}

        {owner ? (
          <Group title={t.settings.groupTeam}>
            <SettingsRow
              href="/settings/team"
              icon="users"
              label={t.settings.teamLogins}
              sub={t.settings.teamLoginsSub}
            />
          </Group>
        ) : null}

        {showBookings ? (
          <Group title={t.settings.groupBookings}>
            {showQr && cardUrl ? <BookingQrRow cardUrl={cardUrl} storeName={storeName} /> : null}
            {can(access, "notifications") ? (
              <SettingsRow
                href="/settings/notifications"
                icon="bell"
                label={t.settings.notifications}
                sub={t.settings.notificationsSub}
              />
            ) : null}
          </Group>
        ) : null}

        <Group title={t.settings.groupAccount}>
          {/* The change-password page, as the app's row opens `settings/password`. It is open to
              every role (no module owns the path). This row used to point at /settings/profile,
              which is profile-gated, so a staff login (profile: none by default) hit "No access"
              and had nowhere on the web to change the password someone else had set for it. */}
          <SettingsRow
            href="/settings/account"
            icon="user"
            label={t.settings.account}
            sub={userName ?? t.settings.accountSub}
          />
          {can(access, "billing") ? (
            <SettingsRow
              href="/settings/subscription"
              icon="creditCard"
              label={t.settings.subscription}
              sub={t.settings.subscriptionSub}
            />
          ) : null}
          <div className="st-row">
            <RowContent
              icon="moon"
              label={t.settings.darkMode}
              sub={t.settings.darkModeSub}
              trailing={
                <button
                  type="button"
                  role="switch"
                  className={`st-switch${dark ? " is-on" : ""}`}
                  aria-checked={dark}
                  aria-label={t.settings.darkMode}
                  onClick={() => setDark(!dark)}
                >
                  <span className="st-switch-track">
                    <span className="st-switch-knob" />
                  </span>
                </button>
              }
            />
          </div>
        </Group>

        <Group title={t.settings.groupSupport}>
          <SettingsRow
            externalHref={`mailto:${SUPPORT.email}`}
            icon="mail"
            label={t.settings.emailSupport}
            sub={SUPPORT.email}
          />
          <SettingsRow
            externalHref={`tel:${SUPPORT.phoneTel}`}
            icon="phone"
            label={t.settings.callSupport}
            sub={SUPPORT.phoneDisplay}
          />
        </Group>

        {/* The demo role picker that once lived here is gone: a user cannot choose their own
            role. It comes from the server with the session. */}
        <div className="st-signout-wrap">
          <button type="button" className="st-signout" onClick={onSignOut} disabled={signingOut}>
            <span className="st-signout-icon" aria-hidden>
              {signingOut ? <Spinner size={18} /> : <Icon name="logOut" size={18} />}
            </span>
            {t.settings.signOut}
          </button>
        </div>
      </div>

      {/* No version, unlike the app's footer: a web deploy is always the current build, and
          owner-web's package.json version (0.1.0) has never been bumped — printing it would repeat
          the app's "v2.4 that never shipped" mistake (docs/mobile-settings-screen.md). */}
      <p className="st-footer">
        {userName ? format(t.settings.footer, { username: userName }) : t.settings.footerNoUser}
      </p>
    </div>
  );
}
