import { PageHeader } from "@/components/PageHeader";
import { StaffEditor } from "@/components/StaffEditor";
import { getStaff } from "@/lib/server-api";

export default async function StaffSettingsPage() {
  const res = await getStaff();
  return (
    <div className="wrap">
      <PageHeader title="Staff" subtitle="Seats and team members" />
      <StaffEditor staff={(res?.data ?? []).filter((s) => s.isActive)} />
    </div>
  );
}
