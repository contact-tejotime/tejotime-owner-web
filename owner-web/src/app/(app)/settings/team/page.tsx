import { redirect } from "next/navigation";
import { t } from "@/i18n";

import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { TeamManager } from "@/components/TeamManager";
import { isOwnerRole, NO_ACCESS } from "@/lib/roles";
import { getMe, getPermissionCatalogue, getStaff, getTeam } from "@/lib/server-api";

/**
 * Team logins — the owner's view of everyone who can sign in to this business. The app's
 * `settings/team.tsx`: subtitle, one card per login, then the add buttons or the add form.
 *
 * Gated on the ROLE rather than a permission, matching `GET /users` on the backend. "Can create
 * logins" is the one thing an owner cannot hand out, because whoever holds it can grant
 * themselves every other permission.
 */
export default async function TeamSettingsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!isOwnerRole(me.user.role)) redirect("/settings");

  const [team, staff, catalogue] = await Promise.all([
    getTeam(),
    getStaff(),
    getPermissionCatalogue(),
  ]);

  return (
    <SettingsSubpageShell title={t.teamPage.title} width="wide">
      <p className="sa-lead">{t.teamPage.subtitle}</p>

      {team ? (
        <TeamManager
          users={team.data}
          staff={staff?.data ?? []}
          // Straight from the backend catalogue, so "the default" means the same thing here as
          // in the guard that enforces it. NO_ACCESS only if that call failed — a new login
          // starting closed is recoverable; one starting open is not.
          staffDefaults={catalogue?.defaults.staff ?? NO_ACCESS}
          currentUserId={me.user.id}
        />
      ) : (
        <p className="sa-error">{t.teamPage.loadError}</p>
      )}
    </SettingsSubpageShell>
  );
}
