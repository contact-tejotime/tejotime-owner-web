import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { listBusinesses } from "@/lib/server-api";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Authenticated shell for the whole admin panel. Verifies the signed session
 * cookie (authoritative check — middleware only does a fast presence redirect)
 * and, if valid, renders the sidebar + page content. Unauthenticated visitors
 * are sent to /login before any store data is fetched.
 */
export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const stores = await listBusinesses();
  return (
    <div className="app">
      <Sidebar stores={stores} />
      <div className="main">{children}</div>
    </div>
  );
}
