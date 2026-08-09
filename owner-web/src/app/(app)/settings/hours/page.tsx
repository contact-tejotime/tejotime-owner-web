import { PageHeader } from "@/components/PageHeader";
import { HoursEditor } from "@/components/HoursEditor";
import { getBusiness } from "@/lib/server-api";

export default async function HoursSettingsPage() {
  const business = await getBusiness();
  return (
    <div className="wrap">
      <PageHeader title="Opening hours" subtitle="Shown on your microsite" />
      <HoursEditor hours={business?.hours ?? []} />
    </div>
  );
}
