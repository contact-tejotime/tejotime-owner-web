"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { BottomNav } from "@/components/BottomNav";
import { RoleGate } from "@/components/RoleGate";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  if (!ready || !session) {
    return (
      <div className="wrap">
        <p className="empty">Loading…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <RoleGate>{children}</RoleGate>
      </div>
      <BottomNav />
    </div>
  );
}
