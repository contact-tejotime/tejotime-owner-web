import { redirect } from "next/navigation";
import { t } from "@/i18n";

import { CommissionEditor } from "@/components/CommissionEditor";
import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { can, NO_ACCESS } from "@/lib/roles";
import { getCommissionRates, getMe } from "@/lib/server-api";
import "@/styles/settings-b.css";

/**
 * Commission rates — what each stylist earns per visit, and from which day. The web twin of the
 * app's settings/commission.tsx. See docs/staff-commission.md.
 *
 * Owners only (`commission: manage`, which only owner roles hold — staff get `view`). Its own page,
 * not a section of Staff & seats: /settings/staff is open to any login with the `staff` permission,
 * and a pay rate is not something a staff member may set, or even see for a colleague.
 */
export default async function CommissionRatesPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!can(me.user.permissions ?? NO_ACCESS, "commission", "manage")) redirect("/settings");

  const rates = await getCommissionRates();

  return (
    <SettingsSubpageShell title={t.commission.title}>
      <p className="sa-lead">{t.commission.lead}</p>
      {rates ? <CommissionEditor rates={rates} /> : <p className="sb-error">{t.commission.errLoad}</p>}
    </SettingsSubpageShell>
  );
}
