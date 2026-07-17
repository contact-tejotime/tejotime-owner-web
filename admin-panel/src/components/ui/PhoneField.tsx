"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flagEmoji, searchCountries } from "@/lib/phone";
import { t } from "@/i18n";
import { Icon } from "@/components/icons";

export type PhoneValue = { dialCode: string; national: string; iso2: string };

type Props = {
  value: PhoneValue;
  onChange: (v: PhoneValue) => void;
  label?: string;
  id?: string;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Extra content rendered under the field (e.g. a hint). */
  hint?: React.ReactNode;
};

/**
 * Country-code dropdown (searchable) + national-number input.
 * Emits { dialCode, national, iso2 }; callers combine dialCode + national into
 * the stored phone (E.164 for customers, bare digits for logins/slugs).
 */
export default function PhoneField({
  value,
  onChange,
  label,
  id,
  required,
  placeholder = t.phoneField.defaultPlaceholder,
  autoFocus,
  disabled,
  hint,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const results = useMemo(() => searchCountries(query), [query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus(); // return focus to the trigger, not lost to <body>
      }
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
    onChange({ ...value, iso2, dialCode });
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  return (
    <div className="field phone-field" ref={wrapRef}>
      {label && (
        <label htmlFor={id}>
          {label}
          {required ? " *" : ""}
        </label>
      )}
      <div className="phone-row">
        <button
          ref={triggerRef}
          type="button"
          className="phone-cc"
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t.phoneField.selectCountryCode}
        >
          <span className="phone-flag">{flagEmoji(value.iso2)}</span>
          <span className="phone-dial">+{value.dialCode}</span>
          <span className="phone-caret" aria-hidden>
            <Icon name="chevronDown" size={16} />
          </span>
        </button>
        <input
          id={id}
          className="phone-number"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={placeholder}
          value={value.national}
          onChange={(e) => onChange({ ...value, national: e.target.value.replace(/[^\d]/g, "") })}
          required={required}
          autoFocus={autoFocus}
          disabled={disabled}
        />
      </div>

      {open && (
        <div className="phone-pop" role="listbox" aria-label={t.phoneField.countries}>
          <input
            ref={searchRef}
            className="phone-search"
            type="search"
            placeholder={t.phoneField.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="phone-list">
            {results.length === 0 && <li className="phone-empty">{t.phoneField.noMatches}</li>}
            {results.map((c) => (
              <li key={c.iso2}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.iso2 === value.iso2}
                  className={"phone-opt" + (c.iso2 === value.iso2 ? " sel" : "")}
                  onClick={() => pick(c.iso2, c.dialCode)}
                >
                  <span className="phone-flag">{flagEmoji(c.iso2)}</span>
                  <span className="phone-optname">{c.name}</span>
                  <span className="phone-optdial">+{c.dialCode}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hint}
    </div>
  );
}
