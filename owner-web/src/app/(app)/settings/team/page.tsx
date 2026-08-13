import { redirect } from "next/navigation";
import { t } from "@/i18n";

import { PageHeader } from "@/components/PageHeader";
import { TeamManager } from "@/components/TeamManager";
import { isOwnerRole, NO_ACCESS } from "@/lib/roles";
import { getMe, getPermissionCatalogue, getStaff, getTeam } from "@/lib/server-api";

/**
 * Team logins — the owner's view of everyone who can sign in to this business.
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
    <div className="wrap">
      <PageHeader
        title={t.teamPage.title}
        subtitle={t.teamPage.subtitle}
      />

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
        <p className="home-empty">{t.teamPage.loadError}</p>
      )}
    </div>
  );
}
