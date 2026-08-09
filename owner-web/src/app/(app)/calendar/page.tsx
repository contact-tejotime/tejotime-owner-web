"use client";

import { useMemo, useState } from "react";
import { AppPageHeader } from "@/components/AppPageHeader";
import { Icon } from "@/components/Icon";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function buildGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

function key(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function CalendarPage() {
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState(today);

  const grid = useMemo(() => buildGrid(year, month), [year, month]);
  const booked = useMemo(() => new Set([key(new Date(year, month, 1)), key(new Date(year, month, 2)), key(new Date(year, month, 3))]), [year, month]);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }

  return (
    <div className="page-app">
      <AppPageHeader title="Calendar" />

      <div className="cal-month-nav">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={prevMonth}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <div className="cal-month-label">
          {MONTHS[month]} {year}
        </div>
        <button type="button" className="icon-btn" aria-label="Next month" onClick={nextMonth}>
          <Icon name="chevronRight" size={20} />
        </button>
      </div>

      <div className="cal-app-grid">
        {WEEKDAYS.map((d, i) => (
          <div key={`${d}-${i}`} className="cal-app-head">
            {d}
          </div>
        ))}
        {grid.map((cell) => {
          const inMonth = cell.getMonth() === month;
          const isSelected = key(cell) === key(selected);
          const hasDot = booked.has(key(cell));
          return (
            <button
              key={key(cell)}
              type="button"
              className={`cal-app-day ${inMonth ? "" : "muted"} ${isSelected ? "selected" : ""}`}
              onClick={() => setSelected(cell)}
            >
              <span>{cell.getDate()}</span>
              {hasDot && !isSelected ? <span className="cal-dot" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
