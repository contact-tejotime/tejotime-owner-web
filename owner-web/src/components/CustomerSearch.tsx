"use client";

import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { useEffect, useState } from "react";

import { Icon } from "@/components/Icon";

/**
 * Server-side customer search.
 *
 * Pushes the query into the URL so the page re-renders from `GET /customers?search=`. Filtering
 * client-side would only search the slice the free plan lets through, silently hiding matches.
 *
 * Drawn as the app's `TSearchInput` (a standard field with a leading search icon, not a pill) —
 * styles in `styles/customers.css`.
 */
export function CustomerSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);

  useEffect(() => {
    if (q === initialQuery) return;
    const timer = setTimeout(() => {
      router.replace(q ? `/customers?q=${encodeURIComponent(q)}` : "/customers");
    }, 300);
    return () => clearTimeout(timer);
  }, [q, initialQuery, router]);

  return (
    <div className="cu-search">
      <Icon name="search" size={18} className="cu-search-icon" />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        // Names and phone numbers: the app turns these off too, so "ravi" is not "corrected".
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t.search.placeholder}
        aria-label={t.search.aria}
      />
    </div>
  );
}
