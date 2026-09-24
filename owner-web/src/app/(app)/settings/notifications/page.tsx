import { t } from "@/i18n";

import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { NotificationPrefsCard } from "./NotificationPrefsCard";

/** Notifications — the app's `settings/notifications.tsx`: one card of switches and a note. */
export default function NotificationsSettingsPage() {
  return (
    <SettingsSubpageShell title={t.notifications.title}>
      <NotificationPrefsCard />
    </SettingsSubpageShell>
  );
}
