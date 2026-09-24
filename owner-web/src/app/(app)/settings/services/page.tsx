import { t } from "@/i18n";

import { ServicesEditor } from "@/components/ServicesEditor";
import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { getServices } from "@/lib/server-api";
import "@/styles/settings-b.css";

/**
 * Services & pricing — the app's settings/services.tsx: back + title, the menu as one card of
 * rows, "Add service" under it, and a sheet to add or edit. `wide` so the list can go two-up on a
 * tablet and fill the width beside the sidebar; see settings-b.css.
 */
export default async function ServicesSettingsPage() {
  const res = await getServices();
  return (
    <SettingsSubpageShell title={t.services.title} width="wide">
      <ServicesEditor services={(res?.data ?? []).filter((s) => s.isActive)} />
    </SettingsSubpageShell>
  );
}
