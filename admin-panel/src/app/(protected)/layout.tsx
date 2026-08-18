import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { getMe, listBusinesses } from "@/lib/server-api";
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

  // The store list is already scoped by the backend — an employee's is just shorter. `me` is a
  // separate call because the JWT carries no role: it has a 12h life, and a role baked into it
  // would keep a demoted employee on the owner's navigation until it expired.
  const [stores, me] = await Promise.all([listBusinesses(), getMe()]);

  return (
    <div className="app">
      {/* An unreadable /admin/me (backend down) falls back to the least privilege, not the most. */}
      <Sidebar stores={stores} role={me?.role ?? "employee"} />
      <div className="main">{children}</div>
    </div>
  );
}
