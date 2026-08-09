import { redirect } from "next/navigation";

import { BusinessProfileForm } from "@/components/BusinessProfileForm";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { PageHeader } from "@/components/PageHeader";
import { can, NO_ACCESS, ROLE_LABELS } from "@/lib/roles";
import { getBusiness, getMe } from "@/lib/server-api";

/**
 * Your account, plus the business profile if you are allowed to edit it.
 *
 * Both halves are on one page on purpose: a staff member reaching Settings needs somewhere to
 * change the password their owner handed them, and that somewhere should not be a screen they
 * only see if they were also granted the business profile.
 */
export default async function ProfileSettingsPage() {
  const me = await getMe();
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  const canEditBusiness = can(access, "profile", "manage");
  const business = canEditBusiness ? await getBusiness() : null;

  return (
    <div className="wrap">
      <PageHeader title="Profile" subtitle="Business and account details" />

      {canEditBusiness ? (
        <BusinessProfileForm
          name={business?.name ?? me.business.name}
          address={business?.address ?? ""}
        />
      ) : null}

      <div className="section">
        <h2>Your account</h2>
        <div className="field">
          <label htmlFor="pf-user">Name</label>
          <input id="pf-user" defaultValue={me.user.name ?? ""} readOnly />
        </div>
        <div className="field">
          <label htmlFor="pf-role">Role</label>
          <input
            id="pf-role"
            defaultValue={
              me.user.isSuperOwner ? "Owner (account holder)" : ROLE_LABELS[me.user.role]
            }
            readOnly
          />
        </div>
        <p className="hint">
          Your name is set by whoever created this login. Ask the business owner to change it.
        </p>
      </div>

      <ChangePasswordForm />
    </div>
  );
}
