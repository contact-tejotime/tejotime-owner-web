"use client";

import { useMemo, useState } from "react";
import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon } from "@/components/Icon";
import { MOCK_CUSTOMERS, MOCK_STATS } from "@/lib/mock-data";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function CustomersPage() {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return MOCK_CUSTOMERS;
    return MOCK_CUSTOMERS.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.phone.includes(needle),
    );
  }, [q]);

  return (
    <div className="page-app">
      <AppPageHeader
        title="Customers"
        subtitle={`Free trial · latest ${MOCK_CUSTOMERS.length} shown`}
      />

      <div className="search-field">
        <Icon name="search" size={18} className="search-icon" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or phone"
          aria-label="Search customers"
        />
      </div>

      <div className="customer-list">
        {filtered.map((c) => (
          <article key={c.id} className="customer-card">
            <div className="customer-card-top">
              <div className="customer-avatar">{initials(c.name)}</div>
              <div>
                <div className="nm">{c.name}</div>
                <div className="meta">{c.phone}</div>
              </div>
            </div>
            <div className="customer-card-meta">
              <div>
                <div className="label">Visits</div>
                <div className="val">{c.visits}</div>
              </div>
              <div>
                <div className="label">Last visit</div>
                <div className="val">{c.lastVisit}</div>
              </div>
              <div>
                <div className="label">Spend</div>
                <div className="val">{c.spend}</div>
              </div>
            </div>
          </article>
        ))}
      </div>

      {MOCK_STATS.lockedClients > 0 ? (
        <div className="upsell-card">
          <div className="upsell-icon">
            <Icon name="star" size={22} color="#F59E0B" />
          </div>
          <h3>{MOCK_STATS.lockedClients} more clients locked</h3>
          <p>Upgrade to Premium to see your full customer list and history.</p>
          <button type="button" className="btn block">
            <Icon name="creditCard" size={18} color="#fff" />
            Upgrade to Premium
          </button>
        </div>
      ) : null}
    </div>
  );
}
