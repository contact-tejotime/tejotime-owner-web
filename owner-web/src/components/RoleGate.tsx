"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { canAccessPath } from "@/lib/roles";

export function RoleGate({ children }: { children: React.ReactNode }) {
  const { session, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!canAccessPath(session.user.role, pathname)) {
      // stay on page — NoAccessUI renders below
    }
  }, [ready, session, pathname, router]);

  if (!ready) {
    return (
      <div className="wrap">
        <p className="empty">Loading…</p>
      </div>
    );
  }

  if (!session) return null;

  if (!canAccessPath(session.user.role, pathname)) {
    return (
      <div className="no-access">
        <h1>No access</h1>
        <p>
          Your role (<strong>{session.user.role}</strong>) cannot open this page.
          Ask an owner or switch the demo role in the sidebar.
        </p>
        <Link href="/dashboard" className="btn">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
