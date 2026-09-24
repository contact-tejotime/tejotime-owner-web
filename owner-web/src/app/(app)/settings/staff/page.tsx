import { t } from "@/i18n";

import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { StaffEditor } from "@/components/StaffEditor";
import { getStaff } from "@/lib/server-api";
import "@/styles/settings-b.css";

/**
 * Staff & seats — the app's settings/staff.tsx: back + title, the chairs as one card of rows, the
 * one-line note, "Add staff member", and a sheet to add or edit (photo, name, role).
 */
export default async function StaffSettingsPage() {
  const res = await getStaff();
  return (
    <SettingsSubpageShell title={t.staffEditor.title} width="wide">
      <StaffEditor staff={(res?.data ?? []).filter((s) => s.isActive)} />
    </SettingsSubpageShell>
  );
}
