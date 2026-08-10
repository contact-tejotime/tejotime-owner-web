import { redirect } from "next/navigation";

import { AccountSettingsPanel } from "@/components/AccountSettingsPanel";
import { BusinessProfileForm } from "@/components/BusinessProfileForm";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { PageHeader } from "@/components/PageHeader";
import { StoreProfileEditor } from "@/components/StoreProfileEditor";
import { StoreProfileHeader } from "@/components/StoreProfileHeader";
import { can, isOwnerRole, NO_ACCESS, ROLE_LABELS } from "@/lib/roles";
import { getBusiness, getBusinessQr, getMe } from "@/lib/server-api";

/**
 * Your account, plus the store's public profile if you own it.
 *
 * Two different editors on purpose:
 *
 *   owner / co-owner  → store hub header + full store profile editor.
 *   staff with `profile: manage` → name and address only.
 */
export default async function ProfileSettingsPage() {
  const me = await getMe();
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  const owner = isOwnerRole(me.user.role);
  const canEditBusiness = can(access, "profile", "manage");
  const business = canEditBusiness || owner ? await getBusiness() : null;
  const qr = owner && business ? await getBusinessQr() : null;

  const phoneFull =
    qr?.phoneFull ||
    (business ? `${business.countryCode ?? ""}${business.phoneNumber ?? ""}` : "");

  return (
    <div className="wrap">
      {owner && business ? (
        <>
          <StoreProfileHeader
            name={business.name}
            isActive={business.isActive}
            category={business.category}
            area={business.area}
            city={business.city}
            phoneFull={phoneFull}
            visitUrl={qr?.bookingUrl ?? null}
            cardUrl={qr?.cardUrl ?? null}
          />
          <StoreProfileEditor key={business.id} business={business} />
        </>
      ) : (
        <>
          <PageHeader
            title="Profile"
            subtitle="Business and account details"
          />
          {canEditBusiness ? (
            <BusinessProfileForm
              name={business?.name ?? me.business.name}
              address={business?.address ?? ""}
            />
          ) : null}
        </>
      )}

      <AccountSettingsPanel>
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
      </AccountSettingsPanel>
    </div>
  );
}
