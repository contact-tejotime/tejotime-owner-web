import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/LegalPage";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: t.accessibility.metaTitle,
  description: t.accessibility.metaDescription,
};

export default function AccessibilityPage() {
  return <LegalPage doc={t.accessibility} current="/accessibility" />;
}
