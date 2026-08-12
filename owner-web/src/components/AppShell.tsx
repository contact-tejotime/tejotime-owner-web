import { Sidebar } from "@/components/Sidebar";
import { BottomNav } from "@/components/BottomNav";
import { RoleGate } from "@/components/RoleGate";
import { StoreThemeStyle, storeThemeAttrs } from "@/components/StoreThemeStyle";
import { SupportContact, SupportStrip } from "@/components/SupportContact";
import { NO_ACCESS } from "@/lib/roles";
import { Toaster } from "@/lib/toast";
import type { Me } from "@/lib/server-api";

/**
 * App chrome. A server component: the session is resolved by (app)/layout.tsx before this
 * renders, so there is no loading state and no client-side redirect.
 *
 * Navigation is driven by `me.user.permissions` — the map the backend resolved — rather than
 * by re-deriving anything from the role here.
 *
 * Store Appearance is injected here so owner and staff chrome share the microsite brand.
 */
export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  // A token minted before the permissions work would arrive without a map. Falling back to
  // "nothing visible" is the wrong-but-safe answer for the one refresh cycle that lasts.
  const access = me.user.permissions ?? NO_ACCESS;
  const themeAttrs = storeThemeAttrs(me.business);

  return (
    <>
      <StoreThemeStyle business={me.business} />
      <div className="app" {...themeAttrs}>
        <Sidebar me={me} access={access} />
        <div className="main">
          <div className="main-body">
            <RoleGate access={access} role={me.user.role}>
              {children}
            </RoleGate>
          </div>
          <footer className="main-support">
            <SupportContact variant="main" />
          </footer>
        </div>
        <SupportStrip />
        <BottomNav access={access} />
        {/* One mount for the whole signed-in area; showToast() reaches it from anywhere. */}
        <Toaster />
      </div>
    </>
  );
}
