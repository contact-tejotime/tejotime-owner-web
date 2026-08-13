"use client";

/**
 * Drives "pick file(s) -> crop each -> hand back the cropped files".
 *
 * One hook serves both shapes. A single-image field enqueues one file and gets one callback; the
 * gallery enqueues N and gets one callback per applied crop, in order, so it can upload each as
 * it lands. Nothing is uploaded until its crop is applied, and cancelling a file drops only that
 * file — the ones already applied stay.
 *
 * Validation runs here, before anything is queued, so an oversized or unsupported file never
 * reaches the cropper. It reports through the caller's own error channel rather than inventing a
 * second one.
 *
 * Batch position lives in state rather than a ref: React Compiler is enabled in both apps, and
 * the counter is read during render to label the modal.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { t, format } from "@/i18n";

import { MAX_BYTES, rejectFile } from "./assets";
import type { CropRequest } from "./ImageCropModal";

type QueueState = {
  /** Files still to crop; index 0 is the one on screen. */
  pending: File[];
  /** How many of the batch have been applied or skipped, so "2 of 3" keeps counting. */
  settled: number;
  /** Size of the batch as selected. */
  total: number;
};

const EMPTY: QueueState = { pending: [], settled: 0, total: 0 };

export type CropQueueOptions = {
  assetType: string;
  /** Called once per applied crop, in selection order. */
  onCropped: (file: File) => void | Promise<void>;
  /** Surfaces validation problems through the field's existing error UI. */
  onError?: (message: string) => void;
  /** Fired when the last file in a batch is applied or cancelled. */
  onDone?: () => void;
};

export function useImageCropQueue({ assetType, onCropped, onError, onDone }: CropQueueOptions) {
  const [state, setState] = useState<QueueState>(EMPTY);
  const [busy, setBusy] = useState(false);

  // Held in a ref so `advance` stays stable while still calling the caller's latest handler.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  /** Drop the current file. Signals the caller once the batch is fully settled. */
  const advance = useCallback(() => {
    setState((prev) => {
      const pending = prev.pending.slice(1);
      if (pending.length === 0) {
        // Deferred: onDone belongs to the caller's render pass, not this updater, and the
        // updater may run twice under StrictMode.
        queueMicrotask(() => onDoneRef.current?.());
        return EMPTY;
      }
      return { ...prev, pending, settled: prev.settled + 1 };
    });
  }, []);

  /** Validate and enqueue. Returns the number of files that entered the crop flow. */
  const enqueue = useCallback(
    (files: File[]): number => {
      const accepted: File[] = [];
      let typeRejected = 0;
      let sizeRejected = 0;

      for (const file of files) {
        const reason = rejectFile(file);
        if (reason === "type") typeRejected++;
        else if (reason === "size") sizeRejected++;
        else accepted.push(file);
      }

      if (typeRejected) onError?.(t.imageCrop.errType);
      else if (sizeRejected) {
        onError?.(format(t.imageCrop.errSize, { mb: Math.round(MAX_BYTES / 1_000_000) }));
      }

      if (accepted.length) setState({ pending: accepted, settled: 0, total: accepted.length });
      return accepted.length;
    },
    [onError],
  );

  const apply = useCallback(
    async (cropped: File) => {
      if (busy) return; // guard against a double-click uploading twice
      setBusy(true);
      try {
        await onCropped(cropped);
      } finally {
        setBusy(false);
      }
      advance();
    },
    [busy, onCropped, advance],
  );

  /** Skip the current file; the rest of the batch continues. */
  const cancelCurrent = useCallback(() => {
    if (busy) return;
    advance();
  }, [busy, advance]);

  const current = state.pending[0];
  const request: CropRequest | null = current
    ? { file: current, assetType, index: state.settled + 1, total: state.total }
    : null;

  return { request, busy, enqueue, apply, cancelCurrent };
}
