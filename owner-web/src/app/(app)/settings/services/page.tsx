import { PageHeader } from "@/components/PageHeader";
import { t } from "@/i18n";
import { ServicesEditor } from "@/components/ServicesEditor";
import { getServices } from "@/lib/server-api";

export default async function ServicesSettingsPage() {
  const res = await getServices();
  return (
    <div className="wrap">
      <PageHeader title={t.pages.servicesTitle} subtitle={t.pages.servicesSubtitle} />
      <ServicesEditor services={(res?.data ?? []).filter((s) => s.isActive)} />
    </div>
  );
}
