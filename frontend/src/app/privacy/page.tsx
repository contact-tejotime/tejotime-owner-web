import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/LegalPage";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: t.privacy.metaTitle,
  description: t.privacy.metaDescription,
};

/**
 * Public privacy policy. The `/privacy` URL is referenced by the Play Console
 * listing and the marketing footer, so it must stay stable.
 */
export default function PrivacyPage() {
  return <LegalPage doc={t.privacy} current="/privacy" />;
}
