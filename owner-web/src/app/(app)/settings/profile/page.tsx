import { redirect } from "next/navigation";
import { t } from "@/i18n";

import { AccountSettingsPanel } from "@/components/AccountSettingsPanel";
import { BusinessProfileForm } from "@/components/BusinessProfileForm";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { SettingsSubpageShell } from "@/components/SettingsSubpageShell";
import { StoreProfileEditor } from "@/components/StoreProfileEditor";
import { StoreProfileHeader } from "@/components/StoreProfileHeader";
import { SbField } from "@/components/store-settings/ui";
import { can, isOwnerRole, NO_ACCESS, ROLE_LABELS } from "@/lib/roles";
import { getBusiness, getBusinessQr, getMe } from "@/lib/server-api";
import "@/styles/settings-b.css";

/**
 * Business profile, plus your own account — the app's settings/profile.tsx on the web.
 *
 * Two different editors on purpose, as in the app:
 *
 *   owner / co-owner  → the full store profile (OwnerStoreProfileForm's nine sections).
 *   staff with `profile: manage` → name, phone (read-only), address and the booking QR.
 *
 * Owner-web keeps one thing the app's screen does not have: the store card (live status, public
 * link, QR), in a side column on a wide monitor. Appearance, which used to be the last section of
 * this form, is its own page now, reached from its own Settings row — as in the app.
 *
 * The account fold (name, role, change password) stays at the bottom: the hub's "Your account"
 * row opens the password page, and this is where an owner still sees their name and role.
 */
export default async function ProfileSettingsPage() {
  const me = await getMe();
  if (!me) redirect("/login");

  const access = me.user.permissions ?? NO_ACCESS;
  const owner = isOwnerRole(me.user.role);
  const canEditBusiness = can(access, "profile", "manage");
  const business = canEditBusiness || owner ? await getBusiness() : null;
  // The QR needs `profile` (view) on the API; everyone who reaches this page has at least that.
  const qr = business ? await getBusinessQr() : null;

  const phoneFull =
    qr?.phoneFull ||
    (business ? `${business.countryCode ?? ""}${business.phoneNumber ?? ""}` : "");

  const account = (
    <div className="sb-account">
      <AccountSettingsPanel>
        <div className="sb-card">
          <div className="sb-card-body">
            <SbField id="pf-user" label={t.account.name} hint={t.account.nameHint} disabled>
              <input id="pf-user" defaultValue={me.user.name ?? ""} readOnly aria-readonly="true" />
            </SbField>
            <SbField id="pf-role" label={t.account.role} disabled>
              <input
                id="pf-role"
                defaultValue={me.user.isSuperOwner ? t.account.ownerRole : ROLE_LABELS[me.user.role]}
                readOnly
                aria-readonly="true"
              />
            </SbField>
          </div>
        </div>

        <ChangePasswordForm />
      </AccountSettingsPanel>
    </div>
  );

  if (owner && business) {
    return (
      <SettingsSubpageShell title={t.profile.title} width="wide">
        <div className="sb-profile sb-profile--aside">
          <aside className="sb-profile-aside">
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
          </aside>
          <div className="sb-profile-main">
            <StoreProfileEditor key={business.id} business={business} />
            {account}
          </div>
        </div>
      </SettingsSubpageShell>
    );
  }

  return (
    <SettingsSubpageShell title={canEditBusiness ? t.profile.title : t.account.section} width="wide">
      <div className="sb-profile">
        <div className="sb-profile-main">
          {/* Without `profile: manage` there is nothing to edit about the store, and the page is
              just the account block (titled "Your account" above). */}
          {canEditBusiness ? (
            <BusinessProfileForm
              name={business?.name ?? me.business.name}
              address={business?.address ?? ""}
              countryCode={business?.countryCode ?? null}
              phoneNumber={business?.phoneNumber ?? null}
              cardUrl={qr?.cardUrl ?? null}
            />
          ) : null}
          {account}
        </div>
      </div>
    </SettingsSubpageShell>
  );
}
