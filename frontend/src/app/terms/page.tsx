import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/LegalPage";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: t.terms.metaTitle,
  description: t.terms.metaDescription,
};

export default function TermsPage() {
  return <LegalPage doc={t.terms} current="/terms" />;
}
