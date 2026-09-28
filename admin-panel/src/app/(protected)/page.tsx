import StoreForm from "@/components/StoreForm";
import { getStoreDraft, listLookups } from "@/lib/server-api";
import { draftToForm } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Create store. `?draft=<id>` opens a parked form in this same page — the sidebar's Drafts link
 * here on purpose, so a draft is not a separate screen that can drift from the real one.
 */
export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string; saved?: string }>;
}) {
  // `saved` rides along only on the redirect that follows "Save as draft", so the freshly opened
  // draft can confirm what just happened (the form remounts on that redirect and has no memory).
  const { draft: draftId, saved } = await searchParams;
  const [categories, draft] = await Promise.all([
    listLookups("business_category"),
    draftId ? getStoreDraft(draftId) : Promise.resolve(null),
  ]);
  // A draft that is gone (discarded elsewhere, or another admin's — the backend 404s both alike)
  // degrades to a blank form rather than an error page.
  return (
    <StoreForm
      // The key is what makes two drafts, one after another, show their own content: they are the
      // same route, so without it React would reuse the first draft's form state.
      key={draft?.id ?? "new"}
      mode="create"
      categories={categories}
      initial={draft ? draftToForm(draft.data) : undefined}
      draftId={draft?.id}
      justSaved={Boolean(draft) && saved === "1"}
    />
  );
}
