"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { SearchIcon } from "@/components/icons";
import Spinner from "@/components/ui/Spinner";

/** Dashboard search — ⌘K/Ctrl+K focuses it; Enter opens /customers pre-filtered. */
export default function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit() {
    const q = term.trim();
    startTransition(() => router.push(q ? `/customers?q=${encodeURIComponent(q)}` : "/customers"));
  }

  return (
    <div className="search-box">
      <SearchIcon />
      <input
        ref={inputRef}
        type="search"
        aria-label={t.search.ariaLabel}
        placeholder={t.search.placeholder}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      {isPending ? (
        <span className="search-kbd" style={{ display: "inline-flex", color: "var(--primary)" }}>
          <Spinner />
        </span>
      ) : (
        <span className="search-kbd">{t.search.kbd}</span>
      )}
    </div>
  );
}
