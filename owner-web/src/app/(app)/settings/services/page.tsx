import { PageHeader } from "@/components/PageHeader";
import { ServicesEditor } from "@/components/ServicesEditor";
import { getServices } from "@/lib/server-api";

export default async function ServicesSettingsPage() {
  const res = await getServices();
  return (
    <div className="wrap">
      <PageHeader title="Services" subtitle="What customers can book" />
      <ServicesEditor services={(res?.data ?? []).filter((s) => s.isActive)} />
    </div>
  );
}
