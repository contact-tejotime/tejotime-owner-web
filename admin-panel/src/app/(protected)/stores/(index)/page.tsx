import StoresTable from "@/components/StoresTable";
import DemoStoresTable from "@/components/DemoStoresTable";
import { listBusinessesWithMetrics, listDemoBusinessesWithMetrics } from "@/lib/server-api";
import { t, format } from "@/i18n";

export const dynamic = "force-dynamic";

export default async function StoresListPage() {
  // One cached request, split: the platform's stores in the main table, the homepage demo stores
  // in their own section below (never counted in the heading, never in bulk actions).
  const [stores, demoStores] = await Promise.all([listBusinessesWithMetrics(), listDemoBusinessesWithMetrics()]);
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{t.stores.title}</h1>
        <p>{format(stores.length === 1 ? t.stores.count : t.stores.countPlural, { count: stores.length })}</p>
      </div>
      <StoresTable stores={stores} />

      {demoStores.length > 0 && (
        <>
          <div className="page-head demo-stores-head">
            <h2>
              {t.stores.demoTitle} <span className="badge badge-demo">{demoStores.length}</span>
            </h2>
            <p>{t.stores.demoNote}</p>
          </div>
          <DemoStoresTable stores={demoStores} />
        </>
      )}
    </div>
  );
}
