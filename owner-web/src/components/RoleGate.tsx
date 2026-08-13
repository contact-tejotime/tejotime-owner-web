"use client";

import Link from "next/link";
import { t, format } from "@/i18n";
import { usePathname } from "next/navigation";

import {
  ROLE_LABELS,
  canAccessPath,
  landingPath,
  type ModuleAccess,
  type UserRole,
} from "@/lib/roles";

/**
 * Hides pages the signed-in account has no business opening.
 *
 * Driven by the permission map from `/auth/me` — the same map the API guards enforce — so what
 * this hides and what the server refuses are the same list by construction.
 *
 * This is presentation only. It stops a nav item being clicked into; it does not stop the
 * underlying API call. The backend is the boundary (middleware/require-permission.ts).
 */
export function RoleGate({
  access,
  role,
  children,
}: {
  access: ModuleAccess;
  role: UserRole;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (canAccessPath(access, pathname)) return <>{children}</>;

  return (
    <div className="no-access">
      <h1>{t.roleGate.noAccess}</h1>
      <p>
        {format(t.roleGate.body, { role: ROLE_LABELS[role] })}
      </p>
      <Link href={landingPath(access)} className="btn">
        {t.roleGate.goBack}
      </Link>
    </div>
  );
}
