import "@/styles/settings-hub.css";

import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { t } from "@/i18n";

/**
 * "Your account" — where the Settings hub's row of that name lands, for EVERY role. The web twin
 * of the app's `settings/password.tsx`, which that row opens: the sub-page shell (back + centred
 * "Change password"), three fields and one full-width button, and back to Settings on success.
 *
 * The row used to open /settings/profile, which RoleGate gates on the `profile` module. Staff
 * logins default to `profile: none`, so they hit "No access" and had nowhere on the web to change
 * the password somebody else had set for them — the first thing a new login should do. No module
 * owns this path (`moduleForPath` → null), so it is reachable by anyone signed in; the password
 * route itself (`/api/account/password` → `/auth/password`) acts on the caller's own login and
 * requires the current password.
 *
 * No name/role card, as on the app: the hub row already shows the name, and owners still have
 * both in Business profile's account fold (AccountSettingsPanel).
 */
export default function AccountSettingsPage() {
  return (
    <SettingsSubpageShell title={t.password.title} width="narrow">
      {/* Bare on a phone, as the app draws it; a card from tablet up (settings-hub.css). */}
      <div className="st-account">
        <ChangePasswordForm variant="page" returnTo="/settings" />
      </div>
    </SettingsSubpageShell>
  );
}
