import StoreForm from "@/components/StoreForm";
import { listLookups } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  const categories = await listLookups("business_category");
  return <StoreForm mode="create" categories={categories} />;
}
