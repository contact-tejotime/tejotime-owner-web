import { notFound } from "next/navigation";
import { ExternalLinkIcon } from "@/components/icons";
import StoreStatusToggle from "@/components/StoreStatusToggle";
import StoreTabs from "@/components/store-hub/StoreTabs";
import StoreVCardQR from "@/components/store-hub/StoreVCardQR";
import { getBusinessDetail } from "@/lib/server-api";
import { frontendUrl } from "@/lib/frontend-url";
import { formatPhone } from "@/lib/phone";
import { t } from "@/i18n";

const FRONTEND_URL = frontendUrl();
// Public backend base — Download vCard hits the live .vcf here; the QR encodes FRONTEND_URL/{phone}/card.
const BACKEND_URL = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

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
  const phoneFull = detail.phoneFull || `${detail.countryCode ?? ""}${detail.phoneNumber ?? ""}`;
  const cardUrl = FRONTEND_URL && phoneFull ? `${FRONTEND_URL}/${phoneFull}/card` : "";
  const vcardUrl = detail.slug ? `${BACKEND_URL}/public/businesses/${detail.slug}/vcard` : "";

  return (
    <div className="wrap">
      <div className="store-head">
        <h1>{detail.name || t.common.unnamed}</h1>
        <span className={`badge ${detail.isActive ? "badge-active" : "badge-inactive"}`}>
          {detail.isActive ? t.storeHub.active : t.storeHub.inactive}
        </span>
        <span className="head-actions">
          {(cardUrl || vcardUrl) && (
            <StoreVCardQR
              cardUrl={cardUrl}
              vcardUrl={vcardUrl}
              storeName={detail.name || t.common.unnamed}
            />
          )}
          <span className="head-actions-divider" aria-hidden="true" />
          {t.storeHub.enabled}
          <StoreStatusToggle
            key={`${detail.id}:${detail.isActive}`}
            storeId={detail.id}
            storeName={detail.name || t.common.unnamed}
            isActive={detail.isActive}
          />
        </span>
      </div>
      <p className="store-head-meta">
        {meta}
        {meta && detail.phoneFull ? " · " : ""}
        {detail.phoneFull ? formatPhone(detail.phoneFull) : ""}
        {FRONTEND_URL && detail.phoneFull && (
          <>
            {" · "}
            <a href={`${FRONTEND_URL}/${detail.phoneFull}`} target="_blank" rel="noreferrer">
              {t.storeHub.visit} <ExternalLinkIcon />
            </a>
          </>
        )}
      </p>
      <StoreTabs storeId={id} />
      {children}
    </div>
  );
}
