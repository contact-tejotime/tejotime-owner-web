import { redirect } from "next/navigation";

import { NO_ACCESS } from "@/lib/roles";
import { getMe } from "@/lib/server-api";
import { SettingsScreen } from "./SettingsScreen";

/**
 * Server shell: resolves the session, then hands the role and business name to the interactive
 * screen. The screen stays a client component because the settings rows have toggles.
 */
export default async function SettingsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  return (
    <SettingsScreen
      role={me.user.role}
      access={me.user.permissions ?? NO_ACCESS}
      businessName={me.business.name}
    />
  );
}
