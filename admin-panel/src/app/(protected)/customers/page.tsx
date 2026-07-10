import CustomersDirectory from "@/components/CustomersDirectory";
import { listPlatformCustomers } from "@/lib/server-api";

export const dynamic = "force-dynamic";

/** Platform-wide customers directory — every store's customers, merged by phone. */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, { customers, stores }] = await Promise.all([searchParams, listPlatformCustomers()]);

  return (
    <div className="wrap">
      <CustomersDirectory customers={customers} stores={stores} initialQuery={q ?? ""} />
    </div>
  );
}
