import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { listBusinesses } from "@/lib/server-api";
import { getAdminToken, readSession } from "@/lib/session";

/**
 * Authenticated shell for the whole admin panel. Reads the admin JWT from the session
 * cookie and checks it isn't expired (UX gate — the backend authoritatively verifies the
 * token's signature on every data call). Unauthenticated visitors are sent to /login
 * before any store data is fetched.
 */
export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = readSession(await getAdminToken());
  if (!session) redirect("/login");

  const stores = await listBusinesses();
  return (
    <div className="app">
      <Sidebar stores={stores} />
      <div className="main">{children}</div>
    </div>
  );
}
