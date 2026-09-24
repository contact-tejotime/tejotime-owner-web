import { Icon } from "@/components/Icon";
import { t } from "@/i18n";
import { StoreBookingQr } from "@/components/StoreBookingQr";
import { formatPhone } from "@/lib/format";

/**
 * The store card at the top of Settings → Business profile (beside the form on a wide monitor).
 *
 * Owner-web's own block — the app's profile screen has no header beyond its title; it puts the
 * booking QR and the public link in Settings rows instead. Kept on the web because it answers the
 * three things an owner opens this page to check (is my page live, where is it, the QR to print),
 * and drawn as an app card so it sits in the same family as the sections under it.
 *
 * Read-only status (Active / Inactive) — owners cannot enable/disable the store here; that stays a
 * platform-admin action. Visit opens the public microsite; QR encodes the booking chooser URL from
 * GET /business/qr.
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
  const phoneLabel = phoneFull ? formatPhone(phoneFull) : "";
  const meta = [category, area, city, phoneLabel].filter(Boolean).join(" · ");

  return (
    <section className="sb-store" aria-label={name || t.storeHeader.unnamed}>
      <div className="sb-store-top">
        <div className="sb-store-id">
          <h2 className="sb-store-name">{name || t.storeHeader.unnamed}</h2>
          <span className={`sb-badge ${isActive ? "is-on" : "is-off"}`}>
            {isActive ? t.storeHeader.active : t.storeHeader.inactive}
          </span>
        </div>
        {cardUrl ? (
          <StoreBookingQr
            cardUrl={cardUrl}
            storeName={name || t.storeHeader.storeFallback}
            buttonClassName="sb-store-qr"
          />
        ) : null}
      </div>
      {meta ? <p className="sb-store-meta">{meta}</p> : null}
      {visitUrl ? (
        <a href={visitUrl} target="_blank" rel="noreferrer" className="sb-store-visit">
          {t.storeHeader.visit} <Icon name="externalLink" size={13} />
        </a>
      ) : null}
    </section>
  );
}
