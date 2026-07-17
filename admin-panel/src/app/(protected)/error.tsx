"use client";

import { useEffect } from "react";
import { t } from "@/i18n";

/**
 * Error boundary for the whole authenticated area. A thrown error (bad payload,
 * a chart render crash, etc.) lands here instead of Next's default full-page
 * error, so the sidebar shell survives and the user can retry.
 */
export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] render error:", error);
  }, [error]);

  return (
    <div className="wrap">
      <div className="page-head">
        <h1>{t.error.title}</h1>
        <p>{t.error.body}</p>
      </div>
      <div className="alert err" role="alert">
        {error.message || t.error.unknown}
      </div>
      <div className="actions" style={{ display: "flex", gap: 10 }}>
        <button type="button" className="btn-primary" onClick={() => reset()}>
          {t.common.tryAgain}
        </button>
        <a className="btn-ghost" href="/dashboard">
          {t.error.goToDashboard}
        </a>
      </div>
    </div>
  );
}
