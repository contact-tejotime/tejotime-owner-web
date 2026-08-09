import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { getMe } from "@/lib/server-api";

/**
 * The authoritative gate for every signed-in page.
 *
 * The proxy already refused anyone without a session cookie, but that is a presence check on an
 * unverified token. This asks the backend who the caller actually is, which also gives the shell
 * the real user and business to render — replacing the localStorage mock the scaffold used.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");

  return <AppShell me={me}>{children}</AppShell>;
}
