# Image upload — minimum and recommended sizes

Added 2026-09-26. Admin panel, owner-web and the mobile app all refuse a photo that is smaller
than its slot's minimum, and tell the uploader the recommended size.

| Slot | Aspect | Recommended (= export ceiling) | Minimum accepted |
|---|---|---|---|
| hero | 4:3 | 2800×2100 | 1600×1200 |
| about | 16:9 | 2560×1440 | 1600×900 |
| gallery | 1:1 | 2400×2400 | 1080×1080 |
| logo | 1:1 | 1024×1024 | 400×400 |
| avatar | 1:1 | 1024×1024 | 400×400 |

## Where it lives

- **Web (admin-panel + owner-web):** `CROP_CONFIG` `minWidth`/`minHeight` and `meetsMinimum()` in
  `admin-panel/src/components/image-crop/assets.ts`. The crop modal shows both sizes under its hint,
  and when a decoded photo is too small it shows the error and disables **Apply crop**. owner-web
  gets it through `npm run sync:crop`. Never edit the owner-web copy by hand.
- **Mobile (`app/`):** `MIN_SIZE` in `app/src/lib/upload.ts` is a **hand mirror** of the table
  above. It checks the picked photo's `width`/`height` (after the picker crop, when editing is on)
  and shows an Alert. If the picker reports no size, the photo is let through. The hero hint in
  `app/src/i18n/en.json` states the size.

## Output format

The hero, about and gallery slots are marked `photo: true` and **always export JPEG**. A canvas
can only write 32-bit truecolour PNG. A compact 8-bit palette PNG (3 MB at 3753×2100) came back
larger than 5 MB after cropping, and `/uploads/sign` refused it with "File too large (max 5MB)".
If a JPEG is still over 5 MB, the encode steps quality down from the slot's 0.98 until it fits,
stopping at 0.6. Logo and avatar keep the source format so transparent PNGs stay transparent.
The mobile app uploads the picked file as it is, so this doesn't apply there.

## Crop frame could render the wrong aspect ratio (fixed 2026-09-26)

The crop modal's frame div was `width: 100%; aspect-ratio: <slot aspect>; max-height: 46vh`. CSS
clamps the *height* to `max-height` but does not shrink `width` back to match, so on a short
browser window the frame silently rendered **wider than the slot's aspect** (e.g. 1.6 instead of
hero's 1.333). `cropToFile` assumes the frame IS the slot's aspect — it reuses one scale factor
(`f = out.width / frame.width`) for both axes — so a mismatched frame made it draw the cover-fit
sized for the wrong (shorter) box into the taller output canvas, leaving the untouched rows at
top and bottom as flat white bands. This reproduced with a fully opaque source photo (no
transparency at all), so it was **the cropper's own layout bug**, not a property of the uploaded
file. Fixed by deriving the frame's width from the height cap instead
(`width: min(100%, calc(46vh * aspect))`), so `aspect-ratio` is the only thing that ever
determines height and the frame can no longer diverge from the slot's aspect.

## Zoom can go below "fill the frame" (added 2026-09-26)

Until now `MIN_ZOOM` was `1`, meaning the crop frame could never show anything but a full-bleed
crop — there was no way to keep the whole photo visible with space around it. `MIN_ZOOM` is now
`0.2`. The pan/export code already tolerated `zoom < 1` with no changes needed: `panBounds`
already clamps to `Math.max(0, …)` (nothing to pan once the whole photo fits in the frame), the
live preview already reveals the frame's checkerboard behind a smaller image, and `cropToFile`
already fills unpainted canvas white for photo slots (JPEG has no alpha) or leaves it transparent
for logo/avatar (PNG/WebP). So zooming out now produces a **deliberate** margin — white for
hero/about/gallery, transparent for a logo/avatar PNG — as an owner's choice, shown with a "Empty
space around the photo will be filled white" note for photo slots. `IDENTITY.zoom` is still `1`,
so nothing changes for an owner who never touches the slider.

## Limits

- **Client-side only.** `POST /uploads/sign` receives only the byte size, not the pixel size, so a
  direct API caller can still upload a small image.
- **Upright size only.** A portrait photo is judged by its upright width, even though the cropper
  can rotate it.

## Why

Before this, a hero was sometimes uploaded with transparent bands already inside the file. The
microsite paints the hero with `background-size: cover` over a white panel, so those bands showed
as white strips above and below the photo. The size gate and the size hint push uploaders toward
full-frame photos. A PNG with transparent edges that is big enough will still pass, so the only
fix for an existing bad hero is to re-upload a clean photo.
