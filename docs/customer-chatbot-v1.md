# TejoTime chatbot — v1

**Status:** shipped 2026-09-11, **off by default** (`CHATBOT_ENABLED=false`).

**Two surfaces, both in `frontend/`, one flag and one widget:**

| Surface | URL | Answers about | Endpoint |
|---|---|---|---|
| Customer store microsite | `tejotime.com/{phone}` | one shop: hours, services, prices, team, live wait | `POST /public/businesses/:key/chat` |
| Marketing landing page | `tejotime.com/` | the product: what it is, who for, price, getting started | `POST /public/chat` |

Still **not** on owner-web, the admin panel, the Expo app, or WhatsApp.

A help assistant that answers from what its page already shows, and points at that page's own
buttons when the visitor wants to *do* something. It requires **no paid API key**: with nothing
configured it runs a deterministic matcher over a fact sheet; a free-tier model (Gemini or Groq)
is an optional upgrade behind a seam.

Sections 1–5 describe the store microsite bot, which shipped first. **§5b covers the marketing
landing page bot**, which reuses the same widget, flag, endpoint shape and LLM seam over a
different set of facts.

## 1. Scope — what it is and is not

| Is | Is not |
|---|---|
| A chat launcher on the microsite (`MicrositeClient`) | On owner-web, the admin panel, the mobile app, or WhatsApp |
| Answers from `business.faqs` + public store facts (hours, open/closed, address, phone, services and prices, team, live wait) | A source of anything not on the page — it must not invent prices, hours, services or policies |
| Suggests the page's own buttons: **Join the Waitlist**, **Book an Appointment**, **Check Waitlist Status**, **Call**, **See FAQs** | An actor — it never joins a queue, books a slot, checks anyone out, or calls any mutating API |
| Stateless: the client sends its last few turns with each message | Persisted: no table, no session store, nothing keyed on `sessionId` |
| Hidden until an operator turns the platform flag on | A per-store setting (v1 has one flag for the whole platform) |

## 2. How it answers

Two layers, always in this order. The service is `backend/src/modules/public/chat.service.ts`.

### Layer A — key-free (always available)

`backend/src/lib/chat-faq.ts`, pure TypeScript, no env, no database, no network.

1. **FAQ match** (`matchFaq`). Message and every FAQ question are normalised and tokenised:
   lower-case, punctuation stripped, stopwords dropped, and surface forms mapped onto one
   concept token through a small synonym table ("timings", "opening", "when do you close" →
   `hours`; "gpay", "upi", "cards" → `pay`; "walk-in", "walkins" → `walkin`, …). Score is
   mostly *coverage* (how much of the question the FAQ explains) with a little *precision*;
   tokens found only in the FAQ's answer count half; a literal containment either way is
   near-certain. Best FAQ at or above `0.5` is returned **verbatim** — the owner's own words.
   Below that, no FAQ is offered: a wrong FAQ is worse than an honest "don't know".
2. **Store facts** (`detectIntent` + `factsReply`). If no FAQ fits, the concept tokens pick an
   intent — `hours`, `walkin`, `waitlist`, `track`, `book`, `price`/`services`, `pay`,
   `location`, `contact`, `staff` — and the reply is assembled from the same microsite DTO the
   page renders (so a price the bot quotes is the price on the page, including "₹2,000–₹6,000"
   ranges and "Price on request"). A bare service or team-member name ("haircut?", "is Lisa in?")
   counts as a question about it. Intents the page cannot answer (`cancel`, `kids`, `parking`)
   fall through to the fallback unless an FAQ covered them.
3. **Fallback.** "Sorry, I couldn't find that in *Store*'s info. Please check the FAQ on this
   page, or use the Join the Waitlist, Book an Appointment or Call buttons on this page." —
   worded to what the store actually has (no Call without a number, no Join while closed).

Greetings ("hi", "thanks") get a friendly line rather than a fallback.

### Layer B — optional free LLM

`backend/src/integrations/chatbot.ts`, the same seam shape as `whatsapp.ts`: an interface, a
flag-gated implementation, `{ text: null }` on **any** failure (no key, 429, timeout, malformed
body). It is called only when

- `CHATBOT_ENABLED=true`, `CHATBOT_PROVIDER` ≠ `none`, and `CHATBOT_API_KEY` is set, **and**
- Layer A did not already find a confident FAQ (score ≥ 0.9). A verbatim FAQ beats a
  paraphrase and costs no quota.

The system prompt (`buildSystemPrompt`) spells out the same `StoreFacts` Layer A speaks from,
plus the rules: answer only from them, never invent prices/hours/services/policies, never claim
to have booked or joined, ≤ 80 words, plain text, the customer's language. If the model returns
nothing usable the reply silently degrades to Layer A. The suggested buttons always come from
Layer A's intent detection, so they are consistent whichever layer wrote the text.

## 3. Endpoint

`POST /api/v1/public/businesses/:key/chat` — no auth. `:key` is the store **slug** or its
**digits-only full phone** (the same two keys the microsite URL can carry), resolved by
`resolveBusinessByKey` in one query.

Request (zod, `.strict()` — unknown fields are a 400):

```jsonc
{
  "message": "What are your opening hours?",   // 1..CHATBOT_MAX_MESSAGE_CHARS (500), trimmed
  "sessionId": "3b241101-e2bb-4255-8caf-4136c566a962",  // client UUID, log correlation only
  "history": [                                  // optional, max CHATBOT_MAX_HISTORY (8) turns
    { "role": "user", "content": "hi" },
    { "role": "assistant", "content": "Hello! Ask me about hours." }
  ]
}
```

Response `200`:

```jsonc
{
  "reply": "We are open 10:00 AM to 8:00 PM, Monday to Saturday.",
  "mode": "faq_match",             // faq_match | facts | llm | fallback
  "suggestedActions": [            // 1–3, only what the store can actually offer
    { "type": "join",  "label": "Join the Waitlist" },
    { "type": "book",  "label": "Book an Appointment" }
  ]
}
```

`mode` — `faq_match`: an owner FAQ, verbatim · `facts`: assembled from page facts · `llm`: a
configured model, grounded on the same facts · `fallback`: nothing matched, escalate.
`suggestedActions[].type` ∈ `track | book | join | call | faq`.

Errors (standard envelope): `400 VALIDATION_ERROR` · `404 NOT_FOUND` (unknown key) ·
`404 CHATBOT_DISABLED` (flag off — off is off at the API, not just a hidden button) ·
`429 RATE_LIMITED`.

Rate limit: its own bucket, `publicChat` **20 / hour / IP**. Free text that may fan out to a
metered LLM free tier is the most abuse-prone public write there is, and a chat burst must not
spend the `publicWrite` allowance a real join or booking on the same NAT needs.

The public microsite payload (`GET /public/businesses/:slug`, `/by-phone/:phone`) now carries
`chatbotEnabled: boolean`, derived from `CHATBOT_ENABLED`; the widget mounts only when it is
`true`, so a cached payload from before the feature hides it.

## 4. Flags and environment (backend)

| Var | Default | Notes |
|---|---|---|
| `CHATBOT_ENABLED` | `false` | Master switch. Off ⇒ widget hidden **and** endpoint 404s. |
| `CHATBOT_PROVIDER` | `none` | `none` \| `gemini` \| `groq` \| `openai`. `none` ⇒ Layer A only. |
| `CHATBOT_API_KEY` | `""` | Key for the chosen provider. **Server-side only**; never `NEXT_PUBLIC_*`. |
| `CHATBOT_MODEL` | `""` | Blank ⇒ provider default: `gemini-2.5-flash-lite`, `llama-3.1-8b-instant`, `gpt-4o-mini`. |
| `CHATBOT_MAX_HISTORY` | `8` | Turns the client may send back. |
| `CHATBOT_MAX_MESSAGE_CHARS` | `500` | Per message. |
| `CHATBOT_TIMEOUT_MS` | `8000` | Provider timeout; a slow model degrades to Layer A, never hangs the page. |

All four `backend/.env*.example` files carry the block. Nothing is needed on the frontend: the
widget learns the flag from the payload.

### Turning it on with **no key** (Layer A only)

```
CHATBOT_ENABLED=true
CHATBOT_PROVIDER=none
```

Restart the API. The launcher appears on every microsite; answers come from FAQs and facts.

### Free provider setup

**Gemini (recommended default).** Create a key at Google AI Studio (free tier, no card).

```
CHATBOT_ENABLED=true
CHATBOT_PROVIDER=gemini
CHATBOT_API_KEY=AIza...
# CHATBOT_MODEL=gemini-2.5-flash-lite   # default; override if the catalogue moves
```

**Groq (alternative).** Create a key at console.groq.com (free tier).

```
CHATBOT_ENABLED=true
CHATBOT_PROVIDER=groq
CHATBOT_API_KEY=gsk_...
# CHATBOT_MODEL=llama-3.1-8b-instant    # default
```

**OpenAI (optional, paid, never the default).** `CHATBOT_PROVIDER=openai`, `CHATBOT_API_KEY=sk-...`.
Same wire format as Groq. Nothing in the product requires it.

Model names are env-overridable precisely because free-tier catalogues change; a retired name
is an env edit, not a hotfix. A misconfigured or exhausted provider is logged at `warn` and the
customer still gets the Layer A answer.

## 5. Frontend widget

`frontend/src/components/chat/ChatWidget.tsx` + `chat.css`, mounted at the end of
`MicrositeClient` behind `site.chatbotEnabled`.

- Floating launcher bottom-right, styled from the store's theme tokens (brand colour, radius,
  dark mode) — no "AI" purple, no glow. It lifts above the resume pill while a customer holds
  a ticket, and on phones sits above the sticky action bar.
- Panel: welcome line, three quick chips (**Hours?**, **Walk-ins?**, **How does waitlist
  work?**), messages, suggested-action chips under each reply, input, and the disclaimer
  *"AI/help answers may be imperfect. Use Join Waitlist / Book buttons to take action."* On
  phones the open panel is a full-height sheet.
- Suggested actions call the page's own handlers (`openQueue`, `openBook`, `openTrack`,
  scroll to `#faq`); **Call** is a plain `tel:` link. The widget itself never calls a mutating
  endpoint.
- Errors: a 429 shows "Too many messages for now…", anything else "Couldn't reach the help
  assistant…" — the page keeps working either way.
- Strings live in `frontend/src/i18n/en.json` under `chat`.

## 5b. The marketing landing page bot

Same widget, same flag, same read-only discipline — a different brain, because the landing page
has no business context.

- **Facts**: `backend/src/lib/chat-platform.ts` → `PLATFORM_FACTS`, hand-mirrored from
  `frontend/src/i18n/en.json` → `landingData` (8 product FAQs, 3 plans, 6 features, 3 steps,
  9 industries, the pilot perks). The backend cannot import from `frontend/`, so
  **`npm run check:chat-facts` at the repo root fails if the two drift** — run it after editing
  landing copy. It imports the real module through `tsx` and compares field by field.
- **Endpoint**: `POST /api/v1/public/chat`, same body, same limiter, same `404 CHATBOT_DISABLED`.
  Plus `GET /api/v1/public/chat/status` → `{ enabled: boolean }`, because the landing page is
  statically rendered and has no payload to carry the flag. A failed status call leaves the
  launcher hidden.
- **Suggested actions** are landing-page destinations, not store actions:
  `pilot | pricing | product | industries | demo | faq | signin`. `pilot` opens the same
  Request-access modal every CTA on the page opens, so the bot has no privileged path.
- **The honesty rule that matters here**: the page runs in pilot mode, signup is not self-serve,
  and two of three plans have no price. The bot must never invent a number or promise an account.
  `tests/unit/chat-platform.test.ts` pins exactly that, including a regex that fails if any
  dollar figure appears in a pricing answer.

### Shared machinery

`backend/src/lib/chat-text.ts` holds the ranking both bots use (normalise → tokenise → score →
intent). The *vocabulary* stays with each bot: a shop cares about "timings" and "walk-ins", the
marketing site about "pricing" and "reminders", and one shared dictionary would make every
question look a little like every other. `ChatWidget.tsx` is likewise surface-agnostic — it takes
a `send` function, its copy, and an `onAction` callback, and knows nothing about either surface.

## 6. Limitations (v1)

- **One flag for both surfaces.** `CHATBOT_ENABLED` turns the store bot and the marketing bot on
  together; there is no per-store or per-surface toggle yet.
- **The marketing facts are a hand-mirror.** Guarded by `npm run check:chat-facts`, but that
  guard is not wired into CI, so run it after editing landing copy.
- **English-first matcher.** Layer A's synonym table is English (with Indian-English forms);
  a Hindi or Gujarati question tokenises to nothing it knows and gets the fallback. Layer B
  answers in the customer's language when configured.
- **No memory across page loads**, by design.
- **No analytics** beyond a `pino` line per reply (`businessId`, `sessionId`, `mode`,
  `intent`, `provider` — never the message text).
- **The matcher is heuristic.** A very short or oddly worded question can miss an FAQ that a
  human would match; the fallback always names where to look.
- **Free tiers rate-limit.** Gemini and Groq free quotas are per-project, not per-store; a
  busy platform will see 429s at peak, which degrade to Layer A silently. Watch the `warn`
  log line `chatbot provider rate-limited`.

## 7. Tests

Unit (vitest, no DB, no network — `cd backend && npm test`):

- `tests/unit/chat-faq.test.ts` — tokeniser, FAQ matching (exact, paraphrase, no match, empty,
  ranking), intents, every fact reply, fallback wording, action gating, the system prompt.
- `tests/unit/chatbot.test.ts` — provider seam with `fetch` stubbed: `none` and missing-key
  paths make no call; Gemini/Groq/OpenAI request shapes (key in a header, never the URL;
  default and overridden models; alternating history); 429, network error, malformed body and
  blocked prompt all resolve to `null`.
- `tests/unit/public-chat.test.ts` — the real router + validator + error handler over
  supertest, `getMicrositeByKey` replaced by a fixture: unknown store 404, validation 400s,
  `CHATBOT_DISABLED` 404, `faq_match` / `facts` / `fallback` with **no** network call, the
  phone key, and — with a provider configured — `llm` mode, a verbatim FAQ skipping the model,
  and a failing provider degrading to Layer A.

End-to-end (`backend/scripts/smoke-rest.mjs`, section `PUBLIC CHAT`, against a running
server + seeded throwaway DB): sets FAQs through the owner API, asks them back, checks
`chatbotEnabled`, a live price, the phone key, the fallback, 404/400s, and that a "join for me"
message changes the queue count by nothing and mints no ticket. With `CHATBOT_ENABLED=false`
on the server it asserts the 404 and that the payload hides the widget, then skips the rest.

```
cd backend
DATABASE_URL=<throwaway> npm run migrate && DATABASE_URL=<throwaway> npm run seed
DATABASE_URL=<throwaway> PORT=8090 CHATBOT_ENABLED=true npx tsx src/server.ts &
SMOKE_BASE_URL=http://localhost:8090/api/v1 node scripts/smoke-rest.mjs
```

## 8. Files

| File | Role |
|---|---|
| `backend/src/lib/chat-faq.ts` | Layer A: tokeniser, FAQ matcher, intents, fact replies, actions, system prompt |
| `backend/src/integrations/chatbot.ts` | Layer B seam: Gemini / Groq / OpenAI behind `CHATBOT_PROVIDER` |
| `backend/src/modules/public/chat.service.ts` | `chatWithStore`: facts from the microsite DTO, layer order, logging |
| `backend/src/modules/public/public.routes.ts` | `POST /businesses/:key/chat`, zod schema, `publicChat` limiter |
| `backend/src/modules/public/public.service.ts` | `resolveBusinessByKey`, `getMicrositeByKey`, `chatbotEnabled` in the DTO |
| `backend/src/config/env.ts` · `middleware/rate-limit.ts` | `CHATBOT_*` vars · `publicChat` bucket |
| `frontend/src/components/chat/ChatWidget.tsx` · `chat.css` | The widget |
| `frontend/src/lib/api.ts` · `i18n/en.json` | `publicApi.chat`, DTO types, `chatbotEnabled`, strings |
