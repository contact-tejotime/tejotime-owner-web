import { PageHeader } from "@/components/PageHeader";
import { t } from "@/i18n";
import { StaffEditor } from "@/components/StaffEditor";
import { getStaff } from "@/lib/server-api";

export default async function StaffSettingsPage() {
  const res = await getStaff();
  return (
    <div className="wrap">
      <PageHeader title={t.pages.staffTitle} subtitle={t.pages.staffSubtitle} />
      <StaffEditor staff={(res?.data ?? []).filter((s) => s.isActive)} />
    </div>
  );
}
