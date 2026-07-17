import StoresTable from "@/components/StoresTable";
import { listBusinessesWithMetrics } from "@/lib/server-api";
import { t, format } from "@/i18n";

export const dynamic = "force-dynamic";

export default async function StoresListPage() {
  const stores = await listBusinessesWithMetrics();
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{t.stores.title}</h1>
        <p>{format(stores.length === 1 ? t.stores.count : t.stores.countPlural, { count: stores.length })}</p>
      </div>
      <StoresTable stores={stores} />
    </div>
  );
}
