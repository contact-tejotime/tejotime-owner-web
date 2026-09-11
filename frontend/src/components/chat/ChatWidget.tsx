"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { ApiError, type ChatBody, type ChatReplyOf, type ChatTurn } from "@/lib/api";
import { t, format } from "@/i18n";
import "./chat.css";

/**
 * The help-chat launcher and panel, shared by both surfaces that use it:
 *
 *  - the customer store microsite (docs/customer-chatbot-v1.md), where it answers about one shop;
 *  - the TejoTime marketing landing page, where it answers about the product.
 *
 * The component knows nothing about either. It renders a conversation, calls whatever `send`
 * it was given, and hands every suggested action back to the page through `onAction`. Two rules
 * hold on both surfaces:
 *
 *  - It never acts. A reply may *suggest* a button; tapping one closes the panel and lets the
 *    page do the work. No mutating request is ever made from here, so a chat cannot join a
 *    queue, book a slot or sign anybody up.
 *  - It remembers nothing. The server is stateless; the last few turns ride along with each
 *    message, and closing the tab ends the conversation.
 */

interface Msg {
  id: number;
  role: "user" | "assistant";
  content: string;
  actions?: { type: string; label: string }[];
}

export interface ChatWidgetProps {
  /** The API call for this surface. Must be read-only. */
  send: (body: ChatBody) => Promise<ChatReplyOf<string>>;
  /** Panel heading, e.g. "Ask Sharp Cuts" or "Ask about TejoTime". */
  title: string;
  subtitle: string;
  /** First bubble, rendered but never stored in history. */
  welcome: string;
  /** Starter questions shown until the visitor sends something. */
  chips: string[];
  /**
   * Runs a suggested action. The widget handles `call` itself when `phoneHref` is set; every
   * other type is the page's business.
   */
  onAction: (type: string) => void;
  /**
   * The line under the input. Surface-specific on purpose: a store visitor is told to use Join
   * Waitlist / Book, a marketing visitor to tap Request access. Defaults to the store wording.
   */
  disclaimer?: string;
  /** `tel:` href for a Call suggestion. Without it, a `call` action is not rendered. */
  phoneHref?: string | null;
  /** True while something else owns the bottom-right corner; the launcher lifts above it. */
  lifted?: boolean;
}

// Mirrors the server's zod schema (CHATBOT_MAX_HISTORY / CHATBOT_MAX_MESSAGE_CHARS defaults).
const MAX_HISTORY = 8;
const HISTORY_TURN_CHARS = 2000;
const MAX_MESSAGE_CHARS = 500;

/** Correlates a session's log lines and nothing more; falls back for insecure (plain-http) contexts. */
function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function Bubble({ role, muted = false, children }: { role: Msg["role"]; muted?: boolean; children: ReactNode }) {
  return <div className={`ttChatBubble ${role === "user" ? "isUser" : "isBot"}${muted ? " isMuted" : ""}`}>{children}</div>;
}

export default function ChatWidget({
  send,
  title,
  subtitle,
  welcome,
  chips,
  onAction,
  disclaimer = t.chat.disclaimer,
  phoneHref = null,
  lifted = false,
}: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Minted on first open, in the browser: a server-rendered id would differ from the client's
  // and this one is never rendered, so it stays out of hydration entirely.
  const sessionRef = useRef("");
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!sessionRef.current) sessionRef.current = newSessionId();
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Keep the newest turn in view — including the "Typing…" placeholder and an error line.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending, error]);

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!text || sending) return;
      // The welcome line is rendered, not stored, so history is only real turns.
      const history: ChatTurn[] = messages
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_TURN_CHARS) }));
      setMessages((m) => [...m, { id: nextId.current++, role: "user", content: text }]);
      setInput("");
      setError(null);
      setSending(true);
      try {
        const r = await send({ message: text, sessionId: sessionRef.current, history });
        setMessages((m) => [...m, { id: nextId.current++, role: "assistant", content: r.reply, actions: r.suggestedActions }]);
      } catch (e) {
        setError(e instanceof ApiError && e.status === 429 ? t.chat.errRateLimited : t.chat.errUnavailable);
      } finally {
        setSending(false);
      }
    },
    [messages, sending, send],
  );

  const act = (type: string) => {
    setOpen(false);
    onAction(type);
  };

  return (
    <>
      <button
        type="button"
        className={`ttChatFab${lifted ? " isLifted" : ""}${open ? " isOpen" : ""}`}
        aria-label={open ? t.chat.close : t.chat.open}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? "x" : "messageCircle"} size={22} />
      </button>

      {open && (
        <div className={`ttChatPanel${lifted ? " isLifted" : ""}`} role="dialog" aria-label={title}>
          <div className="ttChatHead">
            <div style={{ minWidth: 0 }}>
              <div className="ttChatTitle">{title}</div>
              <div className="ttChatSub">{subtitle}</div>
            </div>
            <button type="button" className="ttChatClose" aria-label={t.chat.close} onClick={() => setOpen(false)}>
              <Icon name="x" size={18} />
            </button>
          </div>

          <div ref={listRef} className="ttChatList" aria-live="polite">
            <Bubble role="assistant">{welcome}</Bubble>
            {messages.map((m) => (
              <div key={m.id} style={{ display: "contents" }}>
                <Bubble role={m.role}>{m.content}</Bubble>
                {m.role === "assistant" && m.actions && m.actions.length > 0 && (
                  <div className="ttChatActions">
                    {m.actions.map((a) =>
                      a.type === "call" ? (
                        phoneHref ? (
                          <a key="call" className="ttChatAction" href={phoneHref}>
                            {a.label}
                          </a>
                        ) : null
                      ) : (
                        <button key={a.type} type="button" className="ttChatAction" onClick={() => act(a.type)}>
                          {a.label}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <Bubble role="assistant" muted>
                {t.chat.thinking}
              </Bubble>
            )}
            {error && (
              <div className="ttChatError" role="alert">
                {error}
              </div>
            )}
          </div>

          {messages.length === 0 && (
            <div className="ttChatChips">
              {chips.map((c) => (
                <button key={c} type="button" className="ttChatChip" onClick={() => submit(c)}>
                  {c}
                </button>
              ))}
            </div>
          )}

          <form
            className="ttChatForm"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <input
              ref={inputRef}
              className="ttChatInput"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.chat.placeholder}
              aria-label={t.chat.placeholder}
              maxLength={MAX_MESSAGE_CHARS}
              enterKeyHint="send"
              autoComplete="off"
            />
            <button type="submit" className="ttChatSend" disabled={sending || !input.trim()} aria-label={t.chat.send}>
              <Icon name="arrowRight" size={18} />
            </button>
          </form>

          <div className="ttChatDisclaimer">{disclaimer}</div>
        </div>
      )}
    </>
  );
}

/** Convenience for the microsite, which titles the panel with the store's name. */
export function storeChatTitle(name: string): string {
  return format(t.chat.title, { name });
}
