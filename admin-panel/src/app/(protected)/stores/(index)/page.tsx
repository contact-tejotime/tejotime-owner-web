import StoresTable from "@/components/StoresTable";
import { listBusinessesWithMetrics } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function StoresListPage() {
  const stores = await listBusinessesWithMetrics();
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>All stores</h1>
        <p>
          {stores.length} store{stores.length === 1 ? "" : "s"}
        </p>
      </div>
      <StoresTable stores={stores} />
    </div>
  );
}
