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
 */
export function CustomerSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);

  useEffect(() => {
    if (q === initialQuery) return;
    const t = setTimeout(() => {
      router.replace(q ? `/customers?q=${encodeURIComponent(q)}` : "/customers");
    }, 300);
    return () => clearTimeout(t);
  }, [q, initialQuery, router]);

  return (
    <div className="search-field">
      <Icon name="search" size={18} className="search-icon" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t.search.placeholder}
        aria-label={t.search.aria}
      />
    </div>
  );
}
