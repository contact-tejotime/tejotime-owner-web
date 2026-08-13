import { PageHeader } from "@/components/PageHeader";
import { t } from "@/i18n";
import { HoursEditor } from "@/components/HoursEditor";
import { getBusiness } from "@/lib/server-api";

export default async function HoursSettingsPage() {
  const business = await getBusiness();
  return (
    <div className="wrap">
      <PageHeader title={t.pages.hoursTitle} subtitle={t.pages.hoursSubtitle} />
      <HoursEditor hours={business?.hours ?? []} />
    </div>
  );
}
