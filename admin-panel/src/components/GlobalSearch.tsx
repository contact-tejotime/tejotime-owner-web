"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        placeholder="Search stores, customers, phone…"
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
        <span className="search-kbd">⌘K</span>
      )}
    </div>
  );
}
