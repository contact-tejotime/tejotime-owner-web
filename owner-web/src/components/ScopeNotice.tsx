import Link from "next/link";
import { t } from "@/i18n";

import { Icon } from "@/components/Icon";
import type { Me } from "@/lib/server-api";

/**
 * Tells a staff member what they are actually looking at.
 *
 * Their queue, appointments, calendar and dashboard are all narrowed to their own chair by the
 * backend. Without saying so, an empty screen is ambiguous in the worst way — "the shop is
 * quiet" and "I am not seeing my colleagues' work" look identical, and so does the third case:
 *
 *   A staff login with NO chair linked matches nothing at all, so every one of those screens
 *   is permanently empty. That is the safe way to fail (see scopeStaffId — an unlinked account
 *   must not fall back to seeing everything), but silently showing seven days of "Nothing
 *   booked" is a dead end the person cannot diagnose or escape.
 *
 * So: a warning when there is no chair, a quiet line when there is, and nothing at all for
 * owners, who are not scoped and do not need telling.
 */
export function ScopeNotice({ me, context }: { me: Me; context: string }) {
  if (me.user.role !== "staff" && me.user.role !== "manager") return null;

  if (!me.user.staffId) {
    return (
      <div className="scope-notice warn" role="status">
        <Icon name="bell" size={16} />
        <div>
          <strong>{t.scope.noChair}</strong>
          <p>
            Until the business owner links it, {context} will stay empty. Ask them to open
            Settings → Team logins and pick your chair.
          </p>
        </div>
      </div>
    );
  }

  return (
    <p className="scope-notice">
      <Icon name="user" size={14} />
      {t.scope.showingChair}{" "}
      <Link href="/settings/profile" className="home-link">
        {t.scope.yourAccount}
      </Link>
    </p>
  );
}
