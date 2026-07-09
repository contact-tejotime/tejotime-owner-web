import CustomersTable from "@/components/CustomersTable";
import { listStoreCustomers } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function StoreCustomersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customers = await listStoreCustomers(id);

  if (!customers) {
    return <div className="alert err">Could not load customers — is the backend running?</div>;
  }

  return (
    <>
      {customers.meta.total > customers.meta.shown && (
        <p className="table-note">
          Showing the {customers.meta.shown} most recent of {customers.meta.total} customers.
        </p>
      )}
      <CustomersTable storeId={id} customers={customers.data} />
    </>
  );
}
