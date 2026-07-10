import { notFound } from "next/navigation";
import ExternalLinkIcon from "@/components/ExternalLinkIcon";
import StoreStatusToggle from "@/components/StoreStatusToggle";
import StoreTabs from "@/components/store-hub/StoreTabs";
import { getBusinessDetail } from "@/lib/server-api";

const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL ?? "https://www.tejotime.com";

/** Store hub shell — header + tab nav shared by every /stores/[id]/* page. */
export default async function StoreHubLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getBusinessDetail(id);
  if (!detail) notFound();

  const meta = [detail.category, detail.area, detail.city].filter(Boolean).join(" · ");

  return (
    <div className="wrap">
      <div className="store-head">
        <h1>{detail.name || "(unnamed)"}</h1>
        <span className={`badge ${detail.isActive ? "badge-active" : "badge-inactive"}`}>
          {detail.isActive ? "Active" : "Inactive"}
        </span>
        <span className="head-actions">
          Enabled
          <StoreStatusToggle
            key={`${detail.id}:${detail.isActive}`}
            storeId={detail.id}
            storeName={detail.name || "(unnamed)"}
            isActive={detail.isActive}
          />
        </span>
      </div>
      <p className="store-head-meta">
        {meta}
        {meta && detail.phoneFull ? " · " : ""}
        {detail.phoneFull ? `+${detail.phoneFull}` : ""}
        {detail.phoneFull && (
          <>
            {" · "}
            <a href={`${FRONTEND_URL}/${detail.phoneFull}`} target="_blank" rel="noreferrer">
              Visit <ExternalLinkIcon />
            </a>
          </>
        )}
      </p>
      <StoreTabs storeId={id} />
      {children}
    </div>
  );
}
