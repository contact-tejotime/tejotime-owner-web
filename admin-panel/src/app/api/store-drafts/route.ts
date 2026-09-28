import { proxyDraft } from "@/lib/draft-proxy";

/** Save the Create store form as a new draft. The only thing that ever creates one. */
export async function POST(req: Request) {
  return proxyDraft("POST", "/admin/store-drafts", req);
}
