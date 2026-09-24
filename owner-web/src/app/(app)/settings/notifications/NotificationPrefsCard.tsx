"use client";

import { useId, useState } from "react";
import { t } from "@/i18n";

import { SubpageSwitch } from "@/components/SubpageSwitch";

/**
 * The same four rows, in the same order and with the same defaults, as the app's
 * `notificationPrefs` (app/src/data/settings.ts).
 *
 * LOCAL STATE ONLY, exactly as on the app: there is no notification-preferences endpoint, so
 * these switches do not persist and reset on reload. The page used to carry a Save button that
 * had no handler at all; it is gone rather than kept, because a button that pretends to save is
 * worse than no button. When the API exists, wire both surfaces to it together.
 */
const PREFS = [
  { id: "smsConfirm", label: t.notifications.prefs.smsConfirmLabel, sub: t.notifications.prefs.smsConfirmSub, enabled: true },
  { id: "queueAlerts", label: t.notifications.prefs.queueAlertsLabel, sub: t.notifications.prefs.queueAlertsSub, enabled: true },
  { id: "noShowAlerts", label: t.notifications.prefs.noShowAlertsLabel, sub: t.notifications.prefs.noShowAlertsSub, enabled: false },
  { id: "dailySummary", label: t.notifications.prefs.dailySummaryLabel, sub: t.notifications.prefs.dailySummarySub, enabled: true },
];

export function NotificationPrefsCard() {
  const idBase = useId();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PREFS.map((p) => [p.id, p.enabled])),
  );

  return (
    <>
      <div className="sa-card">
        {PREFS.map((p) => {
          const labelId = `${idBase}-${p.id}`;
          return (
            <div key={p.id} className="sa-pref">
              <div className="sa-pref-text">
                <span id={labelId} className="sa-pref-label">
                  {p.label}
                </span>
                <span className="sa-pref-sub">{p.sub}</span>
              </div>
              <SubpageSwitch
                checked={enabled[p.id]}
                labelledBy={labelId}
                onChange={(next) => setEnabled((prev) => ({ ...prev, [p.id]: next }))}
              />
            </div>
          );
        })}
      </div>
      <p className="sa-footnote">{t.notifications.note}</p>
    </>
  );
}
