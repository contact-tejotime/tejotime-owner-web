import { NextRequest, NextResponse } from "next/server";
import { getAdminToken } from "@/lib/session";

/**
 * Photo upload proxy (server-side, so the admin JWT and Supabase never touch the browser):
 *   1. receive the file (multipart) from the panel,
 *   2. ask the backend for a Supabase signed upload URL (Bearer admin JWT),
 *   3. PUT the bytes to Supabase,
 *   4. return the public URL to store on the form.
 */
const BACKEND = process.env.BACKEND_API_BASE_URL ?? "http://localhost:8080/api/v1";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5_000_000;
const ASSET_TYPES = new Set(["hero", "about", "gallery", "logo"]);

export async function POST(req: NextRequest) {
  const token = await getAdminToken();
  if (!token) {
    return NextResponse.json({ error: { message: "Not authenticated" } }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: { message: "Expected a multipart form upload." } }, { status: 400 });
  }

  const file = form.get("file");
  const assetType = String(form.get("assetType") ?? "gallery");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { message: "No file provided." } }, { status: 400 });
  }
  if (!ASSET_TYPES.has(assetType)) {
    return NextResponse.json({ error: { message: "Invalid assetType." } }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: { message: "Only JPEG, PNG or WebP images are allowed." } }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: { message: "File too large (max 5MB)." } }, { status: 400 });
  }

  // 1) Signed URL from the backend.
  let signRes: Response;
  try {
    signRes = await fetch(`${BACKEND}/admin/uploads/sign`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ assetType, contentType: file.type, byteSize: file.size }),
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unreachable";
    return NextResponse.json({ error: { message: `Could not reach the backend API. (${message})` } }, { status: 502 });
  }
  const signJson = await signRes.json().catch(() => ({}));
  if (!signRes.ok) {
    return NextResponse.json({ error: signJson?.error ?? { message: "Failed to sign upload." } }, { status: signRes.status });
  }
  const { uploadUrl, publicUrl } = signJson as { uploadUrl: string; publicUrl: string };

  // 2) PUT the bytes straight to Supabase Storage (server-to-server).
  let putRes: Response;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.type, "x-upsert": "true" },
      body: buffer,
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "upload failed";
    return NextResponse.json({ error: { message: `Upload to storage failed. (${message})` } }, { status: 502 });
  }
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "");
    return NextResponse.json(
      { error: { message: `Storage rejected the upload (${putRes.status}). ${text.slice(0, 200)}` } },
      { status: 502 },
    );
  }

  return NextResponse.json({ publicUrl });
}
