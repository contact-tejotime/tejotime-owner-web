import { redirect } from "next/navigation";
import { t } from "@/i18n";

import { HoursEditor } from "@/components/HoursEditor";
import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { can, NO_ACCESS } from "@/lib/roles";
import { getBusiness, getMe } from "@/lib/server-api";

/**
 * Working hours — the app's `settings/hours.tsx`: seven day rows in one card, then the note.
 *
 * Saving happens on every change, so the page refuses to draw an editable week it could not
 * read. Hours only come back from `GET /business`, which is gated on `profile`; a login with
 * `hours` but no `profile` gets null here, and the old default week in its place would have been
 * written over the store's real hours by the first toggle.
 */
export default async function HoursSettingsPage() {
  const [me, business] = await Promise.all([getMe(), getBusiness()]);
  if (!me) redirect("/login");

  // Cosmetic: the API refuses the write either way (`requirePermission('hours', 'manage')`).
  // Disabling the controls saves a view-only login a failed save on its first click.
  const canEdit = can(me.user.permissions ?? NO_ACCESS, "hours", "manage");

  return (
    <SettingsSubpageShell title={t.hours.title}>
      {business ? (
        <HoursEditor hours={business.hours ?? []} canEdit={canEdit} />
      ) : (
        <p className="sa-error">{t.hours.loadError}</p>
      )}
    </SettingsSubpageShell>
  );
}
