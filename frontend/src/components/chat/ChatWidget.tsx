"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { ApiError, type ChatBody, type ChatReplyOf, type ChatTurn } from "@/lib/api";
import { t, format } from "@/i18n";
import type { ChatFlowBinding } from "./flow/binding";
import type { Card, ChoiceOption, Out } from "./flow/engine";
import "./chat.css";

/**
 * The help-chat launcher and panel, shared by both surfaces that use it:
 *
 *  - the customer store microsite (docs/customer-chatbot-v1.md), where it answers about one shop
 *    and — through a `flow` binding — can check the customer in, book, and manage their visit
 *    (docs/customer-chatbot-booking.md);
 *  - the TejoTime marketing landing page, where it answers about the product.
 *
 * The component knows nothing about either. It renders a conversation, calls whatever `send`
 * it was given, and hands every suggested action back to the page. Two rules hold:
 *
 *  - The widget itself never acts, and the ANSWER BOT never acts. A reply may *suggest* a button.
 *    When the page passes a `flow`, typed messages and taps are offered to that flow first; it is a
 *    deterministic state machine on the page, and it acts only through the page's own join/book
 *    code — never because of anything the answer bot (or a model behind it) wrote.
 *  - It remembers nothing. The server is stateless; the last few turns ride along with each
 *    message, and closing the tab ends the conversation.
 */

interface Msg {
  id: number;
  role: "user" | "assistant";
  content: string;
  actions?: { type: string; label: string }[];
  options?: ChoiceOption[];
  card?: Card;
  /**
   * Which user turn this message belongs to. Options and cards are live only in the current turn,
   * so a tap on a stale "Confirm" from three questions ago cannot fire.
   */
  turn: number;
  /** Part of a guided flow — kept out of the history sent to the answer bot. */
  local?: boolean;
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
  /** Guided flows (check in, book, status…). Omitted on surfaces that only answer questions. */
  flow?: ChatFlowBinding;
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

/**
 * Draws one flow card. A component rather than an inline call so `choose` stays what it is — an
 * event handler handed down as a prop — instead of a function invoked during the widget's render.
 */
function FlowCardSlot({
  render,
  card,
  choose,
  active,
}: {
  render: ChatFlowBinding["renderCard"];
  card: Card;
  choose: (id: string, value: unknown, label: string) => void;
  active: boolean;
}) {
  return <>{render(card, choose, active)}</>;
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
  flow,
}: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  // Minted on first open, in the browser: a server-rendered id would differ from the client's
  // and this one is never rendered, so it stays out of hydration entirely.
  const sessionRef = useRef("");
  const nextId = useRef(1);
  const turnRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = sending || !!flow?.busy;

  const newTurn = () => {
    turnRef.current += 1;
    setTurn(turnRef.current);
  };
  const addUser = (content: string, local: boolean): number => {
    const id = nextId.current++;
    setMessages((m) => [...m, { id, role: "user", content, turn: turnRef.current, local }]);
    return id;
  };

  // The flow adds bot messages through this — as replies, and unprompted when the live ticket
  // changes (your turn, visit complete…).
  const attach = flow?.attach;
  useEffect(() => {
    if (!attach) return;
    return attach((outs: Out[]) => {
      const items: Msg[] = outs.map((o) => ({
        id: nextId.current++,
        role: "assistant",
        content: o.text ?? "",
        options: o.options,
        card: o.card,
        turn: turnRef.current,
        local: true,
      }));
      setMessages((m) => [...m, ...items]);
    });
  }, [attach]);

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
      if (!text || busy) return;
      // The welcome line is rendered, not stored, so history is only real turns — and guided-flow
      // steps (names, phone numbers, "Confirm") are not the answer bot's business.
      const history: ChatTurn[] = messages
        .filter((m) => !m.local && m.content)
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_TURN_CHARS) }));
      newTurn();
      const userId = addUser(text, false);
      setInput("");
      setError(null);
      if (flow && (await flow.onText(text))) {
        setMessages((m) => m.map((x) => (x.id === userId ? { ...x, local: true } : x)));
        return;
      }
      setSending(true);
      try {
        const r = await send({ message: text, sessionId: sessionRef.current, history });
        setMessages((m) => [
          ...m,
          { id: nextId.current++, role: "assistant", content: r.reply, actions: r.suggestedActions, turn: turnRef.current },
        ]);
        flow?.afterServerReply();
      } catch (e) {
        setError(e instanceof ApiError && e.status === 429 ? t.chat.errRateLimited : t.chat.errUnavailable);
      } finally {
        setSending(false);
      }
    },
    [messages, busy, send, flow],
  );

  /** A tapped option or card choice: echo it as the customer's answer, then hand it to the flow. */
  const choose = (id: string, value: unknown, label: string) => {
    if (!flow || busy) return;
    newTurn();
    addUser(label, true);
    setError(null);
    flow.onOption(id, value);
  };

  const act = (type: string, label: string) => {
    // With a flow, Join / Book / Check status run right here in the chat instead of closing it.
    if (flow && !busy) {
      newTurn();
      addUser(label, true);
      if (flow.onAction(type)) return;
    }
    setOpen(false);
    onAction(type);
  };

  const renderOptions = (m: Msg, active: boolean) =>
    m.options && m.options.length > 0 ? (
      <div className="ttChatActions">
        {m.options.map((o) =>
          o.id === "call" ? (
            phoneHref ? (
              <a key={o.id} className="ttChatOption" href={phoneHref}>
                {o.label}
              </a>
            ) : null
          ) : (
            <button
              key={o.id}
              type="button"
              className="ttChatOption"
              disabled={!active || busy || o.disabled}
              onClick={() => choose(o.id, o.value, o.label)}
            >
              {o.label}
            </button>
          ),
        )}
      </div>
    ) : null;

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
            {messages.map((m) => {
              const active = m.turn === turn;
              return (
                <div key={m.id} style={{ display: "contents" }}>
                  {m.content && <Bubble role={m.role}>{m.content}</Bubble>}
                  {m.card && flow && <FlowCardSlot render={flow.renderCard} card={m.card} choose={choose} active={active && !busy} />}
                  {m.role === "assistant" && renderOptions(m, active)}
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
                          <button key={a.type} type="button" className="ttChatAction" onClick={() => act(a.type, a.label)}>
                            {a.label}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {busy && (
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
              {flow?.starters.map((s) => (
                <button key={s.id} type="button" className="ttChatChip isStarter" onClick={() => choose(s.id, undefined, s.label)}>
                  {s.label}
                </button>
              ))}
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
              placeholder={flow?.placeholder ?? t.chat.placeholder}
              aria-label={flow?.placeholder ?? t.chat.placeholder}
              maxLength={MAX_MESSAGE_CHARS}
              enterKeyHint="send"
              // A phone step brings up the dial pad on a phone; everything else is free text.
              type={flow?.inputMode === "tel" ? "tel" : "text"}
              inputMode={flow?.inputMode === "tel" ? "tel" : "text"}
              autoComplete={flow?.inputMode === "tel" ? "tel" : "off"}
            />
            <button type="submit" className="ttChatSend" disabled={busy || !input.trim()} aria-label={t.chat.send}>
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
