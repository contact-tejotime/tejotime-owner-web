import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/LegalPage";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: t.cookies.metaTitle,
  description: t.cookies.metaDescription,
};

/**
 * Public cookie policy. Linked from the consent banner, the preferences dialog, and the Legal
 * column of every footer, so the `/cookies` URL must stay stable.
 *
 * The cookie table in `t.cookies` lists only cookies this product actually sets. Adding an
 * analytics or advertising row "for completeness" would be a false statement about what we do,
 * which is worse for compliance than saying nothing — see the enable checklist in
 * lib/consentMode.ts for what to update on the day a tag is genuinely added.
 */
export default function CookiesPage() {
  return <LegalPage doc={t.cookies} current="/cookies" />;
}
