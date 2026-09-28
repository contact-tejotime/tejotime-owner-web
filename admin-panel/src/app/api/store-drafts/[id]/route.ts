import { proxyDraft } from "@/lib/draft-proxy";

type Ctx = { params: Promise<{ id: string }> };

/** Autosave into an existing draft. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  return proxyDraft("PUT", `/admin/store-drafts/${encodeURIComponent(id)}`, req);
}

/** Discard a draft, or clean it up after the store it became was created. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return proxyDraft("DELETE", `/admin/store-drafts/${encodeURIComponent(id)}`);
}
