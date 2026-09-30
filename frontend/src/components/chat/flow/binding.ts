import type { ReactNode } from "react";
import type { Card, ChoiceOption, Out } from "./engine";

/**
 * What ChatWidget needs from a surface that can ACT through the chat (today: the store microsite).
 *
 * The widget stays surface-agnostic: it renders whatever messages it is pushed, offers a typed
 * message to the flow before the answer bot, and hands taps back. The landing-page bot passes no
 * binding and keeps working exactly as before.
 */
export interface ChatFlowBinding {
  /** Welcome chips that start a flow ("Check in now", "Book appointment", …). */
  starters: ChoiceOption[];
  /** Receives the function the flow uses to add bot messages — including live, unprompted ones. */
  attach: (push: (msgs: Out[]) => void) => () => void;
  /** A typed message. Resolves true when the flow consumed it; false → ask the answer bot. */
  onText: (text: string) => Promise<boolean>;
  /** A tapped option or a choice made inside a card. */
  onOption: (id: string, value?: unknown) => void;
  /** A server-suggested button (join / book / track). True when the flow handled it in-chat. */
  onAction: (type: string) => boolean;
  /** The answer bot replied to something typed mid-flow; lets the flow offer to carry on. */
  afterServerReply: () => void;
  /** Draws a card. `active` is false once the conversation has moved past it. */
  renderCard: (card: Card, choose: (id: string, value: unknown, label: string) => void, active: boolean) => ReactNode;
  /** Keyboard for the input box at this step. */
  inputMode: "text" | "tel";
  placeholder: string;
  /** An effect (join, book, lookup…) is in flight. */
  busy: boolean;
}
