"use client";

import { useMemo, useState } from "react";
import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon } from "@/components/Icon";
import { WalkInSheet } from "@/components/WalkInSheet";
import { MOCK_SEATS } from "@/lib/mock-data";

export default function QueuePage() {
  const [filter, setFilter] = useState("all");
  const [sheetOpen, setSheetOpen] = useState(false);

  const seats = useMemo(() => {
    if (filter === "all") return MOCK_SEATS;
    return MOCK_SEATS.filter((s) => s.id === filter);
  }, [filter]);

  const inQueue = 0;

  return (
    <div className="page-app">
      <AppPageHeader
        title="Queue"
        subtitle={`${MOCK_SEATS.length} seats · ${inQueue} in queue`}
        showSettings
        action={
          <button type="button" className="btn btn-sm" onClick={() => setSheetOpen(true)}>
            <Icon name="plus" size={16} color="#fff" />
            Walk-in
          </button>
        }
      />

      <div className="chip-row">
        <button
          type="button"
          className={`filter-chip ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All {inQueue}
        </button>
        {MOCK_SEATS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`filter-chip ${filter === s.id ? "active" : ""}`}
            onClick={() => setFilter(s.id)}
          >
            {s.name} 0
          </button>
        ))}
      </div>

      <div className="seat-list">
        {seats.map((seat) => (
          <button key={seat.id} type="button" className="seat-card">
            <span className="seat-avatar" style={{ background: seat.color }}>
              {seat.name[0]}
            </span>
            <span className="seat-body">
              <span className="nm">{seat.name}</span>
              <span className="meta">{seat.subtitle}</span>
            </span>
            <span className={`seat-status ${seat.status}`}>{seat.status === "free" ? "Free" : "Busy"}</span>
            <Icon name="chevronRight" size={18} className="seat-chevron" />
          </button>
        ))}
      </div>

      <WalkInSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
