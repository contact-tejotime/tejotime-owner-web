"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flagEmoji, searchCountries } from "@/lib/phone";

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchCountries(query), [query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
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
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Select country code"
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

      {open && (
        <div
          role="listbox"
          aria-label="Countries"
          style={{
            position: "absolute",
            zIndex: 40,
            top: "100%",
            left: 0,
            marginTop: 6,
            width: "min(340px, 100%)",
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
            placeholder="Search country or code…"
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
            }}
          />
          <ul style={{ listStyle: "none", margin: 0, padding: 4, maxHeight: 260, overflowY: "auto" }}>
            {results.length === 0 && (
              <li style={{ padding: 12, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>No matches</li>
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
        </div>
      )}
    </div>
  );
}
