import { redirect } from "next/navigation";
import { t } from "@/i18n";

import { AppearanceEditor } from "@/components/appearance/AppearanceEditor";
import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { isOwnerRole } from "@/lib/roles";
import { getBusiness, getMe } from "@/lib/server-api";
import "@/styles/settings-b.css";

/**
 * Settings → Appearance — the app's settings/appearance.tsx: how the store's customer website
 * looks. Owner / co-owner only, as in the app (which sends anyone else back to Settings); the API
 * refuses the `theme` column for everyone else anyway (OWNER_ONLY_COLUMNS in business.service).
 * The route is also gated on the `profile` module (lib/roles PATH_MODULES), like the profile it
 * was split out of.
 */
export default async function AppearanceSettingsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!isOwnerRole(me.user.role)) redirect("/settings");

  const business = await getBusiness();

  return (
    <SettingsSubpageShell title={t.appearance.title} width="wide">
      {business ? (
        <AppearanceEditor
          key={business.id}
          business={{
            theme: business.theme,
            themeColor: business.themeColor,
            category: business.category,
            countryCode: business.countryCode,
            phoneNumber: business.phoneNumber,
          }}
        />
      ) : (
        <p className="sb-alert" role="alert">
          {t.appearance.loadError}
        </p>
      )}
    </SettingsSubpageShell>
  );
}
