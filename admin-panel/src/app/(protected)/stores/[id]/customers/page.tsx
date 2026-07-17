import CustomersTable from "@/components/CustomersTable";
import { listStoreCustomers } from "@/lib/server-api";
import { t, format } from "@/i18n";

export const dynamic = "force-dynamic";

export default async function StoreCustomersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customers = await listStoreCustomers(id);

  if (!customers) {
    return <div className="alert err">{t.storeCustomers.loadError}</div>;
  }

  return (
    <>
      {customers.meta.total > customers.meta.shown && (
        <p className="table-note">
          {format(t.storeCustomers.truncated, { shown: customers.meta.shown, total: customers.meta.total })}
        </p>
      )}
      <CustomersTable storeId={id} customers={customers.data} />
    </>
  );
}
