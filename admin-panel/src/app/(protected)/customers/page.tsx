import PlatformCustomersTable from "@/components/PlatformCustomersTable";
import { formatCount } from "@/lib/format";
import { listPlatformCustomers } from "@/lib/server-api";

export const dynamic = "force-dynamic";

/** Platform-wide customers directory — every store's customers, merged by phone. */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, { customers, total, stores }] = await Promise.all([searchParams, listPlatformCustomers()]);

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Customers</h1>
        <p>{formatCount(total)} across all stores</p>
      </div>
      <PlatformCustomersTable customers={customers} stores={stores} initialQuery={q ?? ""} />
    </div>
  );
}
