"use client";

import { useRouter } from "next/navigation";
import { t, format } from "@/i18n";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Skeleton";
import { ACCEPT_ATTR, CHECKERBOARD, ImageCropModal, useImageCropQueue } from "@/components/image-crop";
import { EditSheet } from "@/components/store-settings/EditSheet";
import { SbEmpty, SbField } from "@/components/store-settings/ui";
import type { StaffRow } from "@/lib/server-api";
import { showToast } from "@/lib/toast";

/**
 * Staff & seats — the web twin of the app's settings/staff.tsx + StaffEditSheet.
 *
 * Each staff row is a QUEUE SEAT, not a login — creating one here does not create an account, and
 * the microsite shows them as bookable. Clicking a row opens the edit sheet (photo, name, role);
 * the web used to be add-and-delete only, with no way to rename a chair or give it a photo.
 *
 * Removing 409s while the seat still has live queue entries. That code gets the app's wording
 * ("finish or move this chair's customers first") because the backend's own message names the
 * constraint, not the fix.
 *
 * Colours follow the app: a chair's avatar is tinted by its position in the list, cycling the
 * four-colour palette so neighbours differ, and a new chair is created with the colour and
 * position the app would give it.
 */

const COLOR_PALETTE = ["primary", "secondary", "amber500", "green500"] as const;

type StaffFormValues = { name: string; roleLabel: string; photoUrl: string | null };

export function StaffEditor({ staff }: { staff: StaffRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [busy, setBusy] = useState(false);
  // The form's photo upload also has to hold the sheet open; it reports in through this.
  const [uploading, setUploading] = useState(false);

  function openSheet(member: StaffRow | null) {
    setEditing(member);
    setUploading(false);
    setOpenCount((n) => n + 1);
    setOpen(true);
  }

  async function send(url: string, method: string, body: unknown, ok: string, fail: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const message =
          json?.error?.code === "SEAT_HAS_ACTIVE_ENTRIES"
            ? t.staffEditor.errActiveEntries
            : (json?.error?.message ?? fail);
        // The sheet stays open on failure so the owner can read why and act, instead of the row
        // silently reappearing.
        showToast(message, "error");
        return false;
      }
      showToast(ok, "success");
      setOpen(false);
      startTransition(() => router.refresh());
      return true;
    } catch {
      showToast(t.staffEditor.networkError, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onSave(f: StaffFormValues) {
    // An empty role becomes "Stylist", as the app does, so the row never reads blank.
    const roleLabel = f.roleLabel || t.staffEditor.roleFallback;
    if (editing) {
      void send(
        `/api/staff/${editing.id}`,
        "PATCH",
        { name: f.name, roleLabel, photoUrl: f.photoUrl },
        t.staffEditor.toastUpdated,
        t.staffEditor.errUpdate,
      );
      return;
    }
    void send(
      "/api/staff",
      "POST",
      {
        name: f.name,
        roleLabel,
        colorToken: COLOR_PALETTE[staff.length % COLOR_PALETTE.length],
        position: staff.length,
        photoUrl: f.photoUrl,
      },
      t.staffEditor.toastAdded,
      t.staffEditor.errAdd,
    );
  }

  function onRemove() {
    if (!editing) return;
    void send(`/api/staff/${editing.id}`, "DELETE", undefined, t.staffEditor.toastRemoved, t.staffEditor.errRemove);
  }

  return (
    <>
      {staff.length === 0 ? (
        <SbEmpty icon="users" title={t.staffEditor.empty} />
      ) : (
        <ul className="sb-list">
          {staff.map((s, i) => {
            const tone = COLOR_PALETTE[i % COLOR_PALETTE.length];
            // The app's row reads name + role. A chair that takes no walk-ins is the exception
            // worth flagging on the web, where that flag was always shown; the default says nothing.
            const sub = [s.roleLabel || t.staffEditor.roleFallback, s.acceptsWalkIns ? null : t.staffEditor.appointmentsOnly]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={s.id} className="sb-list-item">
                <button
                  type="button"
                  className="sb-item"
                  onClick={() => openSheet(s)}
                  title={format(t.staffEditor.editAria, { name: s.name })}
                >
                  {s.avatarUrl ? (
                    <span className="sb-avatar" aria-hidden>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.avatarUrl} alt="" />
                    </span>
                  ) : (
                    <span className={`sb-avatar sb-tone-${tone}`} aria-hidden>
                      {s.name.trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="sb-item-body">
                    <span className="sb-item-name">{s.name}</span>
                    <span className="sb-item-sub">{sub}</span>
                  </span>
                  <Icon name="chevronRight" size={18} className="sb-item-icon" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="sb-footnote">{t.staffEditor.note}</p>

      <button type="button" className="sb-btn sb-btn--outline sb-btn--block sb-add" onClick={() => openSheet(null)}>
        <Icon name="plus" size={18} />
        {t.staffEditor.add}
      </button>

      <EditSheet
        open={open}
        title={editing ? t.staffEditor.editTitle : t.staffEditor.addTitle}
        locked={busy || uploading}
        onClose={() => setOpen(false)}
      >
        {open ? (
          <StaffForm
            key={openCount}
            member={editing}
            busy={busy}
            onUploadingChange={setUploading}
            onSave={onSave}
            onRemove={onRemove}
          />
        ) : null}
      </EditSheet>
    </>
  );
}

/** Remounted per opening (via key) so its fields seed from props without effects. */
function StaffForm({
  member,
  busy,
  onUploadingChange,
  onSave,
  onRemove,
}: {
  member: StaffRow | null;
  busy: boolean;
  onUploadingChange: (uploading: boolean) => void;
  onSave: (f: StaffFormValues) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(member?.name ?? "");
  // Seeded with "Stylist", as the app's sheet is, so the common case needs no typing.
  const [role, setRole] = useState(member?.roleLabel ?? t.staffEditor.roleFallback);
  const [photoUrl, setPhotoUrl] = useState<string | null>(member?.avatarUrl ?? null);
  const [uploading, setUploadingState] = useState(false);
  const [error, setError] = useState("");

  const setUploading = (v: boolean) => {
    setUploadingState(v);
    onUploadingChange(v);
  };

  const clearPicker = () => {
    // So choosing the SAME file again still fires a change event.
    if (inputRef.current) inputRef.current.value = "";
  };

  // Crop first (square — the avatar is drawn as a circle), then upload through the BFF's
  // /api/upload, which signs with the owner's token server-side; the browser never holds a
  // storage credential. The saved URL is only sent to the API when the form is saved.
  const crop = useImageCropQueue({
    assetType: "avatar",
    onError: setError,
    onDone: clearPicker,
    onCropped: async (file) => {
      setUploading(true);
      setError("");
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("assetType", "avatar");
        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.publicUrl) {
          setError(json?.error?.message ?? t.staffEditor.photoFailed);
          return;
        }
        setPhotoUrl(json.publicUrl as string);
      } catch {
        setError(t.staffEditor.photoFailed);
      } finally {
        setUploading(false);
      }
    },
  });

  function pickPhoto() {
    setError("");
    inputRef.current?.click();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t.staffEditor.errName);
      return;
    }
    onSave({ name: name.trim(), roleLabel: role.trim(), photoUrl });
  }

  const locked = busy || uploading;

  return (
    <>
      <form className="sb-form" onSubmit={submit} noValidate>
        <div className="sb-photo-row">
          <button
            type="button"
            className="sb-photo"
            onClick={pickPhoto}
            disabled={locked}
            aria-label={photoUrl ? t.staffEditor.changePhoto : t.staffEditor.addPhoto}
          >
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt={t.staffEditor.photoAria} style={CHECKERBOARD} />
            ) : (
              <Icon name="user" size={26} />
            )}
            {uploading ? (
              <span className="sb-photo-busy">
                <Spinner size={18} />
              </span>
            ) : null}
          </button>
          <div className="sb-photo-actions">
            <button type="button" className="sb-btn sb-btn--outline sb-btn--sm" onClick={pickPhoto} disabled={locked}>
              {uploading ? <Spinner size={14} /> : null}
              {photoUrl ? t.staffEditor.changePhoto : t.staffEditor.addPhoto}
            </button>
            {photoUrl && !uploading ? (
              <button type="button" className="sb-link-danger" onClick={() => setPhotoUrl(null)} disabled={busy}>
                {t.staffEditor.removePhoto}
              </button>
            ) : null}
          </div>
        </div>

        <SbField id="st-name" label={t.staffEditor.nameLabel}>
          <input
            id="st-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            placeholder={t.staffEditor.namePlaceholder}
            // Not `autoFocus` — EditSheet focuses this after noting who opened it (see there).
            data-autofocus={member ? undefined : true}
            maxLength={60}
          />
        </SbField>
        <SbField id="st-role" label={t.staffEditor.roleLabel}>
          <input
            id="st-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={t.staffEditor.rolePlaceholder}
            maxLength={60}
          />
        </SbField>

        {error ? (
          <p className="sb-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="sb-btn sb-btn--primary sb-btn--lg sb-btn--block" disabled={locked}>
          {busy ? <Spinner size={16} /> : null}
          {t.staffEditor.save}
        </button>
        {/* Only for an existing chair — a new one has nothing to remove. */}
        {member ? (
          <button
            type="button"
            className="sb-btn sb-btn--ghost sb-btn--danger sb-btn--block"
            disabled={locked}
            onClick={onRemove}
          >
            {t.staffEditor.remove}
          </button>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError("");
            if (crop.enqueue([file]) === 0) clearPicker();
          }}
        />
      </form>

      {/* Outside the <form> so nothing in the crop dialog can ever submit it. */}
      {crop.request ? (
        <ImageCropModal
          request={crop.request}
          busy={crop.busy || uploading}
          onApply={crop.apply}
          onCancel={() => {
            crop.cancelCurrent();
            clearPicker();
          }}
        />
      ) : null}
    </>
  );
}
