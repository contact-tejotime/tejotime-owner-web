import Link from "next/link";
import { t } from "@/i18n";

/**
 * Styled 404 inside the authenticated shell. Reached when a page calls
 * notFound() (e.g. an unknown store id) — without this the user would get Next's
 * default unstyled 404 outside the sidebar.
 */
export default function ProtectedNotFound() {
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{t.notFound.title}</h1>
        <p>{t.notFound.body}</p>
      </div>
      <div className="actions" style={{ display: "flex", gap: 10 }}>
        <Link href="/stores" className="btn-primary">
          {t.notFound.allStores}
        </Link>
        <Link href="/dashboard" className="btn-ghost">
          {t.notFound.dashboard}
        </Link>
      </div>
    </div>
  );
}
