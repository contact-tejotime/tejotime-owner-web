import { notFound } from "next/navigation";
import StoreForm from "@/components/StoreForm";
import { getBusinessDetail, listLookups } from "@/lib/server-api";
import { fromDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditStorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, categories] = await Promise.all([getBusinessDetail(id), listLookups("business_category")]);
  if (!detail) notFound();
  return <StoreForm mode="edit" storeId={id} categories={categories} initial={fromDetail(detail)} />;
}
