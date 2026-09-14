"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import ChatWidget from "@/components/chat/ChatWidget";
import { frontendUrl } from "@/lib/frontend-url";
import { SUPPORT } from "@/lib/support";
import { t } from "@/i18n";

class ChatHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function postChat(body: {
  message: string;
  sessionId: string;
  history?: { role: "user" | "assistant"; content: string }[];
}) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new ChatHttpError(res.status, json.error?.message ?? t.chat.errUnavailable);
  }
  return res.json() as Promise<{ reply: string; suggestedActions?: { type: string; label: string }[] }>;
}

/**
 * Owner-web help chat — product FAQ bot (same backend brain as the marketing site).
 * Hidden while CHATBOT_ENABLED is false. Works on /login and inside the signed-in shell.
 */
export default function OwnerHelpChat() {
  const [enabled, setEnabled] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    fetch("/api/chat/status")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j: { enabled?: boolean }) => {
        if (alive) setEnabled(!!j.enabled);
      })
      .catch(() => {
        if (alive) setEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onAction = useCallback(
    (type: string) => {
      const web = frontendUrl();
      switch (type) {
        case "pilot":
        case "demo":
          window.location.href = `mailto:${SUPPORT.email}`;
          break;
        case "signin":
          if (pathname !== "/login") router.push("/login");
          break;
        case "pricing":
          if (pathname.startsWith("/settings") || pathname.startsWith("/dashboard") || pathname.startsWith("/queue")) {
            router.push("/settings/subscription");
          } else if (web) {
            window.open(`${web}/#pricing`, "_blank", "noopener,noreferrer");
          } else {
            window.location.href = `mailto:${SUPPORT.email}`;
          }
          break;
        case "product":
        case "industries":
        case "faq":
          if (web) window.open(web, "_blank", "noopener,noreferrer");
          else window.location.href = `mailto:${SUPPORT.email}`;
          break;
        default:
          window.location.href = `mailto:${SUPPORT.email}`;
      }
    },
    [pathname, router],
  );

  if (!enabled) return null;

  return (
    <ChatWidget
      send={postChat}
      title={t.chat.title}
      subtitle={t.chat.subtitle}
      welcome={t.chat.welcome}
      chips={[t.chat.chips.what, t.chat.chips.pricing, t.chat.chips.help]}
      disclaimer={t.chat.disclaimer}
      phoneHref={`tel:${SUPPORT.phoneTel}`}
      onAction={onAction}
    />
  );
}
