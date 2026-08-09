"use client";

import Link from "next/link";
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
      <h1>No access</h1>
      <p>
        Your account ({ROLE_LABELS[role]}) has not been given access to this page. Ask the
        business owner if you need it.
      </p>
      <Link href={landingPath(access)} className="btn">
        Go back
      </Link>
    </div>
  );
}
