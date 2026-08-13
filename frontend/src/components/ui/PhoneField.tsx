"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { flagEmoji, searchCountries } from "@/lib/phone";
import { t } from "@/i18n";
import { useThemePortalContainer } from "@/theme/ThemePortal";

export type PhoneCountry = { dialCode: string; iso2: string };

type Props = {
  country: PhoneCountry;
  national: string;
  onCountryChange: (c: PhoneCountry) => void;
  onNationalChange: (v: string) => void;
  placeholder?: string;
  /** Bottom margin on the wrapper, matching the surrounding inline layout. */
  marginBottom?: number;
};

const inputBase: CSSProperties = {
  padding: "12px 14px",
  border: "1.5px solid var(--border-default)",
  borderRadius: 10,
  fontFamily: "var(--font-sans)",
  fontSize: 15,
  color: "var(--text-strong)",
  outline: "none",
  background: "var(--surface-card)",
  boxSizing: "border-box",
};

/**
 * Country-code dropdown (searchable) + national-number input, styled inline to
 * match the microsite. Parent keeps `national` (digits) and `country`
 * ({ dialCode, iso2 }); combine them into E.164 before sending to the backend.
 */
export default function PhoneField({
  country,
  national,
  onCountryChange,
  onNationalChange,
  placeholder = "00000 00000",
  marginBottom = 16,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<
    { top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null
  >(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchCountries(query), [query]);

  // Where the dropdown mounts: the microsite's themed root when there is one, `<body>`
  // otherwise. It must NOT live in this field's own DOM subtree — any scrollable ancestor
  // (e.g. a modal's `overflow: auto` content area) would clip or scroll-trap it — but it must
  // also stay inside `[data-tt-theme]`, or the store's colour tokens do not reach it and the
  // list paints in the globals.css defaults. See @/theme/ThemePortal.
  const portalContainer = useThemePortalContainer();

  // The dropdown is fixed-positioned against the trigger button, so it is measured against the
  // viewport regardless of which of those two containers it ends up in.
  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 6;
    const width = Math.min(340, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    // Flip above the trigger when there isn't enough room below (e.g. the field sits
    // near the bottom of a modal) but there's more room above.
    const openUpward = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(360, openUpward ? spaceAbove : spaceBelow));
    setPos({
      left,
      width,
      maxHeight,
      top: openUpward ? undefined : rect.bottom + gap,
      bottom: openUpward ? window.innerHeight - rect.top + gap : undefined,
    });
  }

  useEffect(() => {
    if (!open) return;
    updatePosition();
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Capture phase so scrolling inside any nested scroll container (e.g. a modal
    // body) still repositions the portaled dropdown instead of leaving it stranded.
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  function pick(iso2: string, dialCode: string) {
    onCountryChange({ iso2, dialCode });
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", marginBottom }}>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t.phoneField.selectCountryCode}
          style={{
            ...inputBase,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flex: "0 0 auto",
            cursor: "pointer",
            fontWeight: 600 as CSSProperties["fontWeight"],
          }}
        >
          <span style={{ fontSize: 17, lineHeight: 1 }}>{flagEmoji(country.iso2)}</span>
          <span>+{country.dialCode}</span>
          <span style={{ color: "var(--text-muted)", fontSize: 11 }} aria-hidden>
            ▾
          </span>
        </button>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          onChange={(e) => onNationalChange(e.target.value.replace(/[^\d]/g, ""))}
          placeholder={placeholder}
          style={{ ...inputBase, flex: "1 1 auto", minWidth: 0, width: "100%" }}
        />
      </div>

      {open && pos && portalContainer && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          aria-label={t.phoneField.countries}
          style={{
            position: "fixed",
            zIndex: 1000,
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            display: "flex",
            flexDirection: "column",
            background: "var(--surface-card)",
            border: "1.5px solid var(--border-default)",
            borderRadius: 12,
            boxShadow: "0 14px 36px rgba(0,0,0,.16)",
            overflow: "hidden",
          }}
        >
          <input
            ref={searchRef}
            type="search"
            placeholder={t.phoneField.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "11px 13px",
              border: "none",
              borderBottom: "1.5px solid var(--border-default)",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              color: "var(--text-strong)",
              outline: "none",
              background: "var(--surface-card)",
              flex: "0 0 auto",
            }}
          />
          <ul style={{ listStyle: "none", margin: 0, padding: 4, flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
            {results.length === 0 && (
              <li style={{ padding: 12, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>{t.phoneField.noMatches}</li>
            )}
            {results.map((c) => {
              const on = c.iso2 === country.iso2;
              return (
                <li key={c.iso2}>
                  <button
                    type="button"
                    onClick={() => pick(c.iso2, c.dialCode)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      textAlign: "left",
                      padding: "9px 10px",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: on ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "transparent",
                      color: "var(--text-strong)",
                      fontFamily: "var(--font-sans)",
                      fontSize: 14,
                    }}
                  >
                    <span style={{ fontSize: 17, lineHeight: 1 }}>{flagEmoji(c.iso2)}</span>
                    <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.name}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 13, flex: "0 0 auto" }}>+{c.dialCode}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>,
        portalContainer,
      )}
    </div>
  );
}
