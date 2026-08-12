import { Icon } from "@/components/Icon";
import { StoreBookingQr } from "@/components/StoreBookingQr";
import { formatPhone } from "@/lib/format";

/**
 * Admin-style store hub header for Settings → Profile.
 *
 * Read-only status (Active / Inactive) — owners cannot enable/disable the store here; that
 * stays a platform-admin action. Visit opens the public microsite; QR encodes the booking
 * chooser URL from GET /business/qr.
 */
export function StoreProfileHeader({
  name,
  isActive,
  category,
  area,
  city,
  phoneFull,
  visitUrl,
  cardUrl,
}: {
  name: string;
  isActive: boolean;
  category: string | null;
  area: string | null;
  city: string | null;
  phoneFull: string;
  visitUrl: string | null;
  cardUrl: string | null;
}) {
  const meta = [category, area, city].filter(Boolean).join(" · ");
  const phoneLabel = phoneFull ? formatPhone(phoneFull) : "";

  return (
    <div className="store-head">
      <div className="store-head-top">
        <div className="store-head-title">
          <h1>{name || "Unnamed store"}</h1>
          <span className={`status-badge ${isActive ? "on" : "off"}`}>
            {isActive ? "Active" : "Inactive"}
          </span>
        </div>
        {cardUrl ? <StoreBookingQr cardUrl={cardUrl} storeName={name || "Store"} /> : null}
      </div>
      <p className="store-head-meta">
        {meta}
        {meta && phoneLabel ? " · " : null}
        {phoneLabel}
        {visitUrl ? (
          <>
            {(meta || phoneLabel) ? " · " : null}
            <a href={visitUrl} target="_blank" rel="noreferrer" className="store-visit-link">
              Visit <Icon name="externalLink" size={13} />
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
