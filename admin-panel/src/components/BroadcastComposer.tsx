"use client";

import { useState } from "react";
import { t, format } from "@/i18n";

const AUDIENCES = [t.broadcasts.audienceAll, t.broadcasts.audienceCity, t.broadcasts.audiencePlan];
// Canonical channel keys (also the checkbox state keys); labels are proper nouns.
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
      <h2>{t.broadcasts.compose}</h2>
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
        placeholder={t.broadcasts.messagePlaceholder}
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
        <button type="button" className="btn-primary" disabled style={{ marginLeft: "auto" }} title={t.common.comingSoon}>
          {format(ownerCount === 1 ? t.broadcasts.sendTo : t.broadcasts.sendToPlural, { count: ownerCount })}
        </button>
      </div>
      <div className="hint">{t.broadcasts.notWired}</div>
    </div>
  );
}
