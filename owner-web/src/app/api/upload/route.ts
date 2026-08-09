import { NextRequest, NextResponse } from "next/server";

import { assertSameOrigin, BACKEND, unreachable } from "@/lib/http";
import { getAccessToken } from "@/lib/session";

/**
 * Image upload proxy — ported from admin-panel/src/app/api/upload/route.ts.
 *
 * Three hops, all server-side so neither the session token nor the storage credentials ever
 * reach the browser:
 *   1. receive the file (multipart) from the form,
 *   2. ask the backend for a signed upload URL (Bearer owner token),
 *   3. PUT the raw bytes to object storage,
 *   4. return the stable /media/... URL to save on the record.
 *
 * Step 3 sends ONLY `content-type`. Any extra header invalidates the S3 signature.
 */
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5_000_000;
/** owner-web only uploads staff photos today; the rest are admin-panel's business. */
const ASSET_TYPES = new Set(["avatar", "logo", "hero", "about", "gallery"]);

export async function POST(req: NextRequest) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;

  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ error: { message: "Not authenticated" } }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: { message: "Expected a file upload." } }, { status: 400 });
  }

  const file = form.get("file");
  const assetType = String(form.get("assetType") ?? "avatar");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { message: "No file was sent." } }, { status: 400 });
  }
  if (!ASSET_TYPES.has(assetType)) {
    return NextResponse.json({ error: { message: "Unsupported image slot." } }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: { message: "Only JPEG, PNG or WebP images are supported." } },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: { message: "That image is over 5 MB." } }, { status: 400 });
  }

  let signed: Response;
  try {
    signed = await fetch(`${BACKEND}/uploads/sign`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ assetType, contentType: file.type, byteSize: file.size }),
      cache: "no-store",
    });
  } catch (e) {
    return unreachable(e);
  }

  const signedJson = await signed.json().catch(() => ({}));
  if (!signed.ok) return NextResponse.json(signedJson, { status: signed.status });

  const { uploadUrl, publicUrl } = signedJson as { uploadUrl?: string; publicUrl?: string };
  if (!uploadUrl || !publicUrl) {
    return NextResponse.json(
      { error: { message: "The API did not return an upload URL." } },
      { status: 502 },
    );
  }

  try {
    const put = await fetch(uploadUrl, {
      method: "PUT",
      // Nothing else — an extra header breaks the signature.
      headers: { "content-type": file.type },
      body: await file.arrayBuffer(),
    });
    if (!put.ok) {
      return NextResponse.json(
        { error: { message: `Upload failed (${put.status}).` } },
        { status: 502 },
      );
    }
  } catch (e) {
    return unreachable(e);
  }

  return NextResponse.json({ publicUrl });
}
