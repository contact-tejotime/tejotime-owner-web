"use client";

import { useState } from "react";

const AUDIENCES = ["All owners", "City ▾", "Plan ▾"];
const CHANNELS = ["SMS", "WhatsApp", "Push"] as const;

/**
 * Broadcast compose card (wireframe 1c). Visual placeholder — audience pills and
 * channel checkboxes are local state only and sending is disabled until a
 * messaging backend exists.
 */
export default function BroadcastComposer({ ownerCount }: { ownerCount: number }) {
  const [audience, setAudience] = useState(AUDIENCES[0]);
  const [message, setMessage] = useState("");
  const [channels, setChannels] = useState<Record<string, boolean>>({ SMS: true, WhatsApp: true, Push: false });

  return (
    <div className="section">
      <h2>Compose</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {AUDIENCES.map((a) => (
          <button
            key={a}
            type="button"
            className={`pill-choice ${audience === a ? "selected" : ""}`}
            onClick={() => setAudience(a)}
          >
            {a}
          </button>
        ))}
      </div>
      <textarea
        placeholder="New: WhatsApp booking reminders are live…"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
        {CHANNELS.map((ch) => (
          <label key={ch} style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={channels[ch]}
              onChange={(e) => setChannels((c) => ({ ...c, [ch]: e.target.checked }))}
              style={{ width: "auto" }}
            />
            {ch}
          </label>
        ))}
        <button type="button" className="btn-primary" disabled style={{ marginLeft: "auto" }} title="Coming soon">
          Send to {ownerCount} owner{ownerCount === 1 ? "" : "s"}
        </button>
      </div>
      <div className="hint">Sending is not wired up yet — messaging backend coming soon.</div>
    </div>
  );
}
