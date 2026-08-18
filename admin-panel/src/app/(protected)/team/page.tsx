import { notFound } from "next/navigation";
import TeamManager from "@/components/TeamManager";
import { getMe, listAdmins } from "@/lib/server-api";

export const dynamic = "force-dynamic";

/**
 * Platform logins. Owner-only.
 *
 * An employee gets notFound() rather than a redirect or an "access denied" page: the route is
 * not theirs to know about, and the backend already 403s every endpoint behind it, so there is
 * nothing to explain. This gate is presentation — `listAdmins()` would come back empty for them
 * regardless.
 */
export default async function TeamPage() {
  const me = await getMe();
  if (me?.role !== "owner") notFound();

  return (
    <div className="wrap">
      <TeamManager initialMembers={await listAdmins()} />
    </div>
  );
}
