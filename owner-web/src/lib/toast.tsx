"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { t as copy } from "@/i18n";

/**
 * Toasts.
 *
 * The portal had no feedback channel at all: a successful action just re-rendered, and a failed
 * one called `alert()` — a blocking browser dialog that looks like a security warning and reads
 * as a crash. The mobile app has had `showToast` since day one; this is its twin, so the two
 * products say the same things in the same way.
 *
 * A module-level subscriber list rather than a context-only design, so non-React code paths can
 * raise a toast too. `<Toaster />` renders whatever has been pushed.
 */

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l([...toasts]);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Raise a toast from anywhere on the client. Errors linger; successes get out of the way. */
export function showToast(message: string, type: ToastType = "info") {
  const id = nextId++;
  toasts = [...toasts, { id, message, type }];
  emit();
  setTimeout(() => dismiss(id), type === "error" ? 6000 : 3500);
  return id;
}

const ToastContext = createContext<(message: string, type?: ToastType) => number>(showToast);

/** Convenience hook so components read like the app's `useToast()`. */
export function useToast() {
  return useContext(ToastContext);
}

export function Toaster() {
  // Lazily seeded from the module state, which also picks up anything raised between module
  // load and mount — doing that with a setState inside the effect would cascade a second
  // render before the first had painted.
  const [items, setItems] = useState<Toast[]>(() => [...toasts]);

  useEffect(() => {
    const listener: Listener = (next) => setItems(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const onDismiss = useCallback((id: number) => dismiss(id), []);
  const value = useMemo(() => showToast, []);

  if (items.length === 0) return null;

  return (
    <ToastContext.Provider value={value}>
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.message}</span>
            <button
              type="button"
              className="toast-close"
              onClick={() => onDismiss(t.id)}
              aria-label={copy.common.dismiss}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
