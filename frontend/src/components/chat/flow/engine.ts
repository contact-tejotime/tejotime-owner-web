/**
 * The store chat's guided flows — check in, book, waitlist status, leave, my appointments — as a
 * pure state machine (docs/customer-chatbot-booking.md).
 *
 * Why a state machine and not the model: the chat must be able to ACT (join a queue, book a slot,
 * cancel a booking), and nothing a language model says should ever be able to do that. So the
 * server chat endpoint stays read-only, and every action runs through this deterministic
 * machine, which only ever emits an Effect. The page executes the effect through the SAME code the
 * Join / Book pop-up uses, so the two surfaces cannot drift.
 *
 * Deliberately free of React, the DOM and `@/` aliases: frontend/ has no test runner (CLAUDE.md
 * §12.6), so `__tests__/flow-check.ts` drives this file directly through `tsx`.
 *
 *   step(state, input, ctx) → { state, out, effect? }
 *
 * `ctx` is a snapshot of what the page knows right now (services, live staff, open/closed, the
 * held ticket, saved bookings…); `out` is what the bot says; `effect` is the one thing the page
 * must go and do, whose outcome comes back as a `result` input.
 */
import { t, format } from "../../../i18n";

const S = t.chat.flow;

// ---- types ----

export type FlowKind = "join" | "book" | "track" | "leave" | "appts";

/** Steps that collect one field of the draft, in the order they are asked. */
export type FieldStep = "visitor" | "services" | "staff" | "date" | "time" | "name" | "phone" | "sms";
export type Step =
  | FieldStep
  | "summary"
  | "edit"
  | "result"
  | "trackPhone"
  | "leaveConfirm"
  | "apptsPhone"
  | "apptsList"
  | "cancelConfirm";

export interface SlotLite {
  startAt: string;
  label: string;
}

export interface Draft {
  visitorType?: "mr" | "patient";
  /** Pick order is load-bearing: the first becomes the visit's primary service (API side). */
  serviceIds: string[];
  /** "any" or a staff id. Undefined = not asked yet. */
  staffId?: string;
  /** YYYY-MM-DD, viewer-local (never toISOString — that is the UTC day). */
  date?: string;
  slot?: SlotLite;
  name?: string;
  /** E.164. */
  phone?: string;
  sms?: boolean;
}

/**
 * An appointment as the chat lists it. `canCancel` = the page holds its key: it was booked on this
 * device, or the phone lookup handed it over. Since the client decision of 2026-10-05
 * (docs/customer-my-appointments.md) the phone number alone is enough, from any device, so a
 * booking made elsewhere is as cancellable as one made here. The rule "a phone alone never cancels"
 * is gone. A row with no key is now only one the API would refuse anyway (it has started), so it
 * is shown without an action rather than with "call the store".
 */
export interface ApptView {
  appointmentId: string;
  serviceName: string | null;
  staffName: string | null;
  scheduledStartAt: string;
  status: string;
  canCancel: boolean;
  /**
   * One visit of a repeating booking — the card shows the repeat marker, and the action reads
   * "Skip this visit": cancelling a series visit skips just that one (the API records it as
   * skipped), and the rest of the series carries on. The chat itself books single visits in v1
   * (docs/recurring-appointments.md §11).
   */
  repeats?: boolean;
}

export interface FlowState {
  kind: FlowKind | null;
  step: Step | null;
  /** The field steps this run asks, fixed when the flow starts (see sequence()). */
  seq: FieldStep[];
  draft: Draft;
  /** Slots for `slotsKey`, or null while loading. */
  slots: SlotLite[] | null;
  slotsKey: string | null;
  slotsError: boolean;
  allDays: boolean;
  /** "Use another name/number" was chosen — ask instead of offering the remembered one. */
  askName: boolean;
  askPhone: boolean;
  /** Track was started on the way to leaving: once found, go straight to the leave confirm. */
  then: "leave" | null;
  /** The listed appointments (for "Cancel this" lookups) and the one being cancelled. */
  appts: ApptView[];
  pendingAppt: string | null;
  /** A free-text question went to the server mid-flow; prompt to carry on once it answers. */
  aside: boolean;
  /**
   * "Shall we carry on?" is on screen. A typed "yes" now means "carry on", never "confirm": QA
   * found "what are your timings?" → "yes" booking the appointment straight from the summary.
   */
  awaitingContinue: boolean;
}

export interface ChoiceOption {
  id: string;
  label: string;
  disabled?: boolean;
  /** Payload for options that carry one (e.g. a slot's startAt). */
  value?: unknown;
}

export type Card =
  | { type: "services"; selected: string[] }
  | { type: "staff"; kind: "join" | "book" }
  | { type: "slots"; date: string }
  | { type: "summary"; kind: "join" | "book"; draft: Draft }
  | { type: "ticket" }
  | { type: "appointment"; appt: ApptView }
  | { type: "consent" };

export interface Out {
  text?: string;
  options?: ChoiceOption[];
  card?: Card;
}

export type Effect =
  | { type: "askServer" }
  | { type: "fetchSlots"; key: string; date: string; serviceIds: string[]; staffId: string; silent: boolean }
  | { type: "preflightJoin"; draft: Draft }
  | { type: "preflightBook"; draft: Draft; key: string }
  | { type: "join"; draft: Draft }
  | { type: "book"; draft: Draft }
  | { type: "track"; phone: string }
  | { type: "leave" }
  | { type: "lookupAppts"; phone: string }
  | { type: "cancelAppt"; id: string };

export interface FlowError {
  status: number;
  code: string;
  message: string;
  /** The phone is locally blocked or the API rate-limited it (the page's "too many attempts"). */
  blocked?: boolean;
}

export type Input =
  | { kind: "start"; flow: FlowKind; fresh?: boolean }
  | { kind: "text"; text: string }
  | { kind: "option"; id: string; value?: unknown }
  /** The server answered an off-flow question; offer to carry on. */
  | { kind: "aside" }
  /** Periodic / on-focus re-check of whatever the current step shows live (slots). */
  | { kind: "refresh" }
  | { kind: "result"; effect: Effect; ok: true; data: unknown }
  | { kind: "result"; effect: Effect; ok: false; error: FlowError };

export interface HeldTicket {
  token: string;
  status: string;
  /** Owner started the service, or the socket said it is their turn. */
  inService: boolean;
  /**
   * This browser holds the ticket key (it made the join). A place found by phone lookup can be
   * seen but not left — leaving needs the key, so a stranger with your number cannot remove you.
   */
  canLeave: boolean;
}

export interface FlowCtx {
  storeName: string;
  isHospital: boolean;
  services: { id: string; name: string }[];
  /** Live active staff. */
  staff: { id: string; name: string }[];
  walkInsClosed: boolean;
  nextOpenLabel: string | null;
  /** Shop-wide live wait in minutes, already decayed. */
  waitMinutes: number;
  /** Bookable days from today, viewer-local, `closed` already gated on the store having hours. */
  days: { ymd: string; label: string; closed: boolean }[];
  held: HeldTicket | null;
  lastName: string;
  lastPhone: string;
  hasPhone: boolean;
  maxServices: number;
  now: number;
  isBlocked: (phone: string) => boolean;
  /** Typed text → E.164, or null if it is not a valid number. */
  normalizePhone: (raw: string) => string | null;
  maskPhone: (e164: string) => string;
  /** ISO instant → "Thu 2 Oct, 4:30 PM" in the viewer's zone. */
  formatWhen: (iso: string) => string;
}

export interface StepResult {
  state: FlowState;
  out: Out[];
  effect?: Effect;
}

// ---- helpers ----

export function initialState(): FlowState {
  return {
    kind: null,
    step: null,
    seq: [],
    draft: { serviceIds: [] },
    slots: null,
    slotsKey: null,
    slotsError: false,
    allDays: false,
    askName: false,
    askPhone: false,
    then: null,
    appts: [],
    pendingAppt: null,
    aside: false,
    awaitingContinue: false,
  };
}

export function starterOptions(): ChoiceOption[] {
  return [
    { id: "start:join", label: S.starters.join },
    { id: "start:book", label: S.starters.book },
    { id: "start:track", label: S.starters.track },
    { id: "start:appts", label: S.starters.appts },
  ];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}:\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const YES = /^(y|yes|yeah|yep|yup|ok|okay|sure|confirm|correct|right|haan|han|ha|ji|done)$/;
const NO = /^(n|no|nope|nah|not now|nahi|na)$/;
const STOP = /^(stop|cancel|exit|quit|never ?mind|forget it|end)$/;
const BACK = /^(back|go back|previous|undo)$/;
const CONTINUE = /^(continue|carry on|go on|resume|lets continue|lets go)$/;

export const slotsKeyOf = (d: Draft) => `${d.date ?? ""}|${d.serviceIds.join(",")}|${d.staffId ?? "any"}`;

/** The field steps a run asks, in order. Which apply depends on the store (flowScreens parity). */
export function sequence(kind: "join" | "book", ctx: FlowCtx): FieldStep[] {
  const s: FieldStep[] = [];
  if (ctx.isHospital) s.push("visitor");
  if (ctx.services.length > 0) s.push("services");
  if (ctx.staff.length > 0) s.push("staff");
  if (kind === "book") s.push("date", "time");
  s.push("name", "phone", "sms");
  return s;
}

function filled(step: FieldStep, d: Draft): boolean {
  switch (step) {
    case "visitor":
      return !!d.visitorType;
    case "services":
      return d.serviceIds.length > 0;
    case "staff":
      return d.staffId !== undefined;
    case "date":
      return !!d.date;
    case "time":
      return !!d.slot;
    case "name":
      return !!d.name;
    case "phone":
      return !!d.phone;
    case "sms":
      return d.sms !== undefined;
  }
}

/** Clears a field and everything that was chosen on the strength of it. */
function clearField(d: Draft, step: FieldStep): Draft {
  const n: Draft = { ...d, serviceIds: [...d.serviceIds] };
  switch (step) {
    case "visitor":
      n.visitorType = undefined;
      break;
    case "services":
      // A different service mix is a different length of visit — the picked time may not fit.
      n.serviceIds = [];
      n.slot = undefined;
      break;
    case "staff":
      n.staffId = undefined;
      n.slot = undefined;
      break;
    case "date":
    case "time":
      n.date = step === "date" ? undefined : n.date;
      n.slot = undefined;
      break;
    case "name":
      n.name = undefined;
      break;
    case "phone":
      n.phone = undefined;
      break;
    case "sms":
      n.sms = undefined;
      break;
  }
  return n;
}

const idle = (): FlowState => initialState();

function stopped(text: string = S.stopped): StepResult {
  return { state: idle(), out: [{ text, options: starterOptions() }] };
}

function callOption(ctx: FlowCtx): ChoiceOption[] {
  return ctx.hasPhone ? [{ id: "call", label: S.call }] : [];
}

function blockedResult(state: FlowState, ctx: FlowCtx): StepResult {
  return {
    state: { ...state, step: "result" },
    // The block is about the walk-in line only; booking is still open to this number.
    out: [{ text: S.blocked, options: [...callOption(ctx), { id: "start:book", label: S.bookInstead }, { id: "done", label: S.done }] }],
  };
}

function dayLabel(ctx: FlowCtx, ymd: string | undefined): string {
  return ctx.days.find((d) => d.ymd === ymd)?.label ?? ymd ?? "";
}

function waitSentence(ctx: FlowCtx): string {
  return ctx.waitMinutes > 0 ? format(S.waitNow, { min: ctx.waitMinutes }) : S.waitNone;
}

function ticketOptions(ctx: FlowCtx, extra: ChoiceOption[]): ChoiceOption[] {
  const canLeave = !!ctx.held && ctx.held.status === "waiting" && !ctx.held.inService && ctx.held.canLeave;
  return [...(canLeave ? [{ id: "leave", label: S.leaveLine }] : []), ...extra, { id: "done", label: S.done }];
}

// ---- prompts (what the bot says on entering a step) ----

function prompt(state: FlowState, ctx: FlowCtx): StepResult {
  const d = state.draft;
  const kind = state.kind === "book" ? "book" : "join";
  switch (state.step) {
    case "visitor":
      return {
        state,
        out: [
          {
            text: S.visitorQuestion,
            options: [
              { id: "visitor:patient", label: S.visitorPatient },
              { id: "visitor:mr", label: S.visitorMr },
            ],
          },
        ],
      };
    case "services":
      return { state, out: [{ text: S.servicesQuestion, card: { type: "services", selected: d.serviceIds } }] };
    case "staff":
      return {
        state,
        out: [{ text: kind === "book" ? S.staffQuestionBook : S.staffQuestionJoin, card: { type: "staff", kind } }],
      };
    case "date": {
      const days = state.allDays ? ctx.days : ctx.days.slice(0, 7);
      const options: ChoiceOption[] = days.map((day) => ({
        id: `day:${day.ymd}`,
        label: day.closed ? `${day.label} · ${S.dayClosed}` : day.label,
        disabled: day.closed,
      }));
      if (!state.allDays && ctx.days.length > 7) options.push({ id: "moreDates", label: S.moreDates });
      return { state, out: [{ text: S.dateQuestion, options }] };
    }
    case "time": {
      const key = slotsKeyOf(d);
      const next: FlowState = { ...state, slots: null, slotsKey: key, slotsError: false };
      return {
        state: next,
        out: [
          {
            text: format(S.timeQuestion, { day: dayLabel(ctx, d.date) }),
            card: { type: "slots", date: d.date ?? "" },
            options: timeOptions(next, ctx),
          },
        ],
        effect: {
          type: "fetchSlots",
          key,
          date: d.date ?? "",
          serviceIds: d.serviceIds,
          staffId: d.staffId ?? "any",
          silent: false,
        },
      };
    }
    case "name":
      if (ctx.lastName && !state.askName) {
        return {
          state,
          out: [
            {
              text: format(S.nameConfirm, { name: ctx.lastName }),
              options: [
                { id: "name:yes", label: S.nameYes },
                { id: "name:other", label: S.nameOther },
              ],
            },
          ],
        };
      }
      return { state, out: [{ text: S.nameQuestion }] };
    case "phone":
      if (ctx.lastPhone && !state.askPhone && ctx.normalizePhone(ctx.lastPhone)) {
        return {
          state,
          out: [
            {
              text: format(S.phoneConfirm, { phone: ctx.maskPhone(ctx.lastPhone) }),
              options: [
                { id: "phone:yes", label: S.phoneYes },
                { id: "phone:other", label: S.phoneOther },
              ],
            },
          ],
        };
      }
      return { state, out: [{ text: S.phoneQuestion }] };
    case "sms":
      return {
        state,
        out: [
          {
            text: S.smsQuestion,
            card: { type: "consent" },
            // "No" first is not a trick of ordering: the website box is unticked by default, and
            // here neither answer is pre-selected — the customer has to tap one.
            options: [
              { id: "sms:yes", label: S.smsYes },
              { id: "sms:no", label: S.smsNo },
            ],
          },
        ],
      };
    case "summary":
      return {
        state,
        out: [
          {
            text: kind === "book" ? S.summaryBook : S.summaryJoin,
            card: { type: "summary", kind, draft: d },
            options: [
              { id: "confirm", label: S.confirm },
              { id: "change", label: S.change },
              { id: "cancel", label: S.cancel },
            ],
          },
        ],
      };
    case "edit": {
      const labels: Record<FieldStep, string> = {
        visitor: S.visitorQuestion,
        services: S.editServices,
        staff: S.editStaff,
        date: S.editDateTime,
        time: S.editDateTime,
        name: S.editName,
        phone: S.editPhone,
        sms: S.editSms,
      };
      // Day and time are one choice to a customer; offer them once.
      const steps = state.seq.filter((s) => s !== "time");
      return {
        state,
        out: [{ text: S.changeWhat, options: steps.map((s) => ({ id: `edit:${s}`, label: labels[s] })) }],
      };
    }
    case "trackPhone":
      if (ctx.lastPhone && !state.askPhone && ctx.normalizePhone(ctx.lastPhone)) {
        return {
          state,
          out: [
            {
              text: format(S.phoneConfirm, { phone: ctx.maskPhone(ctx.lastPhone) }),
              options: [
                { id: "track:yes", label: S.phoneYes },
                { id: "trackOther", label: S.phoneOther },
              ],
            },
          ],
        };
      }
      return { state, out: [{ text: S.trackQuestion }] };
    case "apptsPhone":
      if (ctx.lastPhone && !state.askPhone && ctx.normalizePhone(ctx.lastPhone)) {
        return {
          state,
          out: [
            {
              text: format(S.phoneConfirm, { phone: ctx.maskPhone(ctx.lastPhone) }),
              options: [
                { id: "appts:yes", label: S.phoneYes },
                { id: "apptsOther", label: S.phoneOther },
              ],
            },
          ],
        };
      }
      return { state, out: [{ text: S.apptsNoneSaved }] };
    case "leaveConfirm":
      return {
        state,
        out: [
          {
            text: format(S.leaveConfirm, { token: ctx.held?.token ?? "" }),
            card: { type: "ticket" },
            options: [
              { id: "leave:yes", label: S.leaveYes },
              { id: "leave:no", label: S.leaveNo },
            ],
          },
        ],
      };
    default:
      return { state, out: [] };
  }
}

function timeOptions(state: FlowState, ctx: FlowCtx): ChoiceOption[] {
  const opts: ChoiceOption[] = [{ id: "anotherDay", label: S.anotherDay }];
  // Same rule as the pop-up's canOfferWalkIn: only for today, and only while walk-ins are open.
  // A walk-in fallback on next Tuesday — or after closing — would mint a token nobody serves.
  if (state.kind === "book" && state.draft.date === ctx.days[0]?.ymd && !ctx.walkInsClosed) {
    opts.push({ id: "walkIn", label: S.walkInInstead });
  }
  return opts;
}

/** Move to the first unanswered field; everything answered → the summary. */
function advance(state: FlowState, ctx: FlowCtx, lead: Out[] = []): StepResult {
  const nextStep: Step = state.seq.find((s) => !filled(s, state.draft)) ?? "summary";
  const r = prompt({ ...state, step: nextStep }, ctx);
  return { ...r, out: [...lead, ...r.out] };
}

// ---- starting a flow ----

function start(kind: FlowKind, ctx: FlowCtx, fresh = false): StepResult {
  const base: FlowState = { ...initialState(), kind, askName: fresh, askPhone: fresh };

  if (kind === "join" || kind === "book") {
    const state: FlowState = { ...base, seq: sequence(kind, ctx) };
    // Walk-in abuse (join → leave, repeatedly) blocks the LINE, not appointments — a blocked
    // number used to be refused booking too, which the store never wanted.
    if (kind === "join" && !fresh && ctx.lastPhone && ctx.isBlocked(ctx.lastPhone)) return blockedResult(state, ctx);
    if (kind === "join") {
      // One live place per number: show it rather than walking them through a duplicate.
      if (ctx.held && !fresh) {
        return {
          state: { ...state, step: "result" },
          out: [
            {
              text: S.held,
              card: { type: "ticket" },
              options: ticketOptions(ctx, [{ id: "different", label: S.differentNumber }]),
            },
          ],
        };
      }
      if (ctx.walkInsClosed) {
        return {
          state: { ...state, step: "result" },
          out: [
            {
              text: ctx.nextOpenLabel
                ? format(S.closedOpens, { name: ctx.storeName, when: ctx.nextOpenLabel })
                : format(S.closedNow, { name: ctx.storeName }),
              options: [{ id: "start:book", label: S.bookInstead }, { id: "done", label: S.done }],
            },
          ],
        };
      }
      return advance(state, ctx, [
        { text: format(S.joinIntro, { name: ctx.storeName, wait: waitSentence(ctx) }) },
      ]);
    }
    return advance(state, ctx, [{ text: format(S.bookIntro, { name: ctx.storeName }) }]);
  }

  if (kind === "track") {
    if (ctx.held) {
      return {
        state: { ...base, step: "result" },
        out: [{ text: S.held, card: { type: "ticket" }, options: ticketOptions(ctx, [{ id: "trackOther", label: S.trackOther }]) }],
      };
    }
    return prompt({ ...base, step: "trackPhone" }, ctx);
  }

  if (kind === "leave") {
    if (ctx.held) return leaveFromHeld(base, ctx);
    const r = prompt({ ...base, kind: "track", step: "trackPhone", then: "leave" }, ctx);
    return { ...r, out: [{ text: S.leaveFindFirst }, ...r.out] };
  }

  // appts — number first, like waitlist status ("Use +91 98…?" / a different number), and only that
  // number's bookings. Nothing is listed from this browser any more (docs/customer-my-appointments.md).
  return prompt({ ...base, step: "apptsPhone" }, ctx);
}

function leaveFromHeld(base: FlowState, ctx: FlowCtx): StepResult {
  const held = ctx.held!;
  if (held.status !== "waiting" || held.inService) {
    return {
      state: { ...base, kind: "leave", step: "result" },
      out: [{ text: S.leaveInService, card: { type: "ticket" }, options: [{ id: "done", label: S.done }] }],
    };
  }
  if (!held.canLeave) {
    return {
      state: { ...base, kind: "leave", step: "result" },
      out: [{ text: S.leaveOtherDevice, card: { type: "ticket" }, options: [...callOption(ctx), { id: "done", label: S.done }] }],
    };
  }
  return prompt({ ...base, kind: "leave", step: "leaveConfirm" }, ctx);
}

// ---- local intent detection (idle / finished flows) ----

/**
 * Plain phrases that clearly ask the chat to DO something. A question ("do you take walk-ins?",
 * "how does the waitlist work?") must NOT match — those still go to the answer bot. Checked here,
 * before the server, so a customer's intent never costs the publicChat allowance.
 */
export function detectIntent(text: string): FlowKind | null {
  const n = norm(text);
  if (!n) return null;
  const place = /\b(queue|line|waitlist|wait list|waiting list|place|spot|token|ticket)\b/;
  if (/\b(leave|exit|quit|cancel|remove)\b/.test(n) && place.test(n)) return "leave";
  if (
    /\b(my|cancel|view|see|check|show|find|reschedule|upcoming)\b/.test(n) &&
    /\b(appointment|appointments|booking|bookings)\b/.test(n) &&
    !/\bbook\b/.test(n)
  ) {
    return "appts";
  }
  if (
    /\b(status|where am i|how many ahead|my (place|turn|token|position|ticket|spot)|check (my )?(place|status|waitlist|turn))\b/.test(n)
  ) {
    return "track";
  }
  if (/\b(check ?in|checkin|join|get in line|put me|add me|sign me)\b/.test(n)) return "join";
  if (/\b(book|schedule|reserve)\b/.test(n) || /\b(make|get|need|want)\b.*\bappointment\b/.test(n)) return "book";
  return null;
}

// ---- typed answers inside a flow ----

function matchServices(text: string, ctx: FlowCtx): string[] {
  const n = norm(text);
  if (!n) return [];
  const hits = ctx.services.filter((s) => {
    const sn = norm(s.name);
    return sn && (n.includes(sn) || (n.length >= 3 && sn.includes(n)));
  });
  // Longest names first so "hair spa" is not also counted as "hair" when both exist.
  return hits.sort((a, b) => b.name.length - a.name.length).map((s) => s.id);
}

function matchStaff(text: string, ctx: FlowCtx): string | null {
  const n = norm(text);
  if (/\b(any|anyone|anybody|no preference|whoever|dont mind|doesnt matter|fastest|soonest)\b/.test(n)) return "any";
  const hit = ctx.staff.find((s) => {
    const sn = norm(s.name);
    return sn && (n === sn || n.includes(sn) || sn.split(" ")[0] === n);
  });
  return hit?.id ?? null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function matchDay(text: string, ctx: FlowCtx): string | null {
  const n = norm(text);
  if (/\btoday\b/.test(n)) return ctx.days[0]?.ymd ?? null;
  if (/\b(tomorrow|tmrw|tmr)\b/.test(n)) return ctx.days[1]?.ymd ?? null;
  const wd = WEEKDAYS.findIndex((w) => n.includes(w) || new RegExp(`\\b${w.slice(0, 3)}\\b`).test(n));
  if (wd >= 0) {
    // The NEXT such weekday: "saturday" on a Saturday means today.
    const hit = ctx.days.find((d) => new Date(`${d.ymd}T12:00:00`).getDay() === wd);
    return hit?.ymd ?? null;
  }
  const num = n.match(/\b(\d{1,2})(st|nd|rd|th)?\b/);
  if (num) {
    const hit = ctx.days.find((d) => Number(d.ymd.slice(8, 10)) === Number(num[1]));
    return hit?.ymd ?? null;
  }
  return null;
}

/** "5", "5pm", "5:30 pm", "17:00" → the matching slot. Bare hours try pm before am. */
export function matchSlot(text: string, slots: SlotLite[]): SlotLite | null {
  const m = norm(text).match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const mer = m[3];
  const minutesOf = (label: string): number | null => {
    const p = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!p) return null;
    let hh = Number(p[1]) % 12;
    if (p[3].toUpperCase() === "PM") hh += 12;
    return hh * 60 + Number(p[2]);
  };
  const candidates: number[] = [];
  if (mer === "am") candidates.push((h % 12) * 60 + min);
  else if (mer === "pm") candidates.push(((h % 12) + 12) * 60 + min);
  else if (h > 12) candidates.push(h * 60 + min);
  else candidates.push(((h % 12) + 12) * 60 + min, (h % 12) * 60 + min);
  for (const c of candidates) {
    const hit = slots.find((s) => minutesOf(s.label) === c);
    if (hit) return hit;
  }
  return null;
}

function textForStep(state: FlowState, raw: string, ctx: FlowCtx): StepResult | null {
  const text = raw.trim();
  const n = norm(text);
  switch (state.step) {
    case "visitor":
      if (/\bpatient\b/.test(n)) return onOption(state, "visitor:patient", undefined, ctx);
      if (/\b(mr|medical|rep|representative)\b/.test(n)) return onOption(state, "visitor:mr", undefined, ctx);
      return null;
    case "services": {
      const ids = matchServices(text, ctx);
      return ids.length ? onOption(state, "services", ids, ctx) : null;
    }
    case "staff": {
      const id = matchStaff(text, ctx);
      return id ? onOption(state, "staff", id, ctx) : null;
    }
    case "date": {
      const ymd = matchDay(text, ctx);
      return ymd ? onOption(state, `day:${ymd}`, undefined, ctx) : null;
    }
    case "time": {
      const hit = state.slots ? matchSlot(text, state.slots) : null;
      return hit ? onOption(state, "slot", hit.startAt, ctx) : null;
    }
    case "name": {
      if (YES.test(n) && ctx.lastName && !state.askName) return onOption(state, "name:yes", undefined, ctx);
      const name = text.replace(/\s+/g, " ").trim();
      // A name is letters, not a phone number or a stray digit.
      if (!name || name.length > 80 || !/\p{L}/u.test(name)) {
        return { state, out: [{ text: S.nameInvalid }] };
      }
      return advance({ ...state, draft: { ...state.draft, name } }, ctx);
    }
    case "phone":
    case "trackPhone":
    case "apptsPhone": {
      if (YES.test(n) && ctx.lastPhone && !state.askPhone) {
        const yes = state.step === "phone" ? "phone:yes" : state.step === "trackPhone" ? "track:yes" : "appts:yes";
        return onOption(state, yes, undefined, ctx);
      }
      const phone = ctx.normalizePhone(text);
      if (!phone) return { state, out: [{ text: S.phoneInvalid }] };
      if (state.step === "trackPhone") return { state, out: [], effect: { type: "track", phone } };
      if (state.step === "apptsPhone") return { state, out: [{ text: S.apptsChecking }], effect: { type: "lookupAppts", phone } };
      return advance({ ...state, draft: { ...state.draft, phone } }, ctx);
    }
    case "sms":
      if (YES.test(n)) return onOption(state, "sms:yes", undefined, ctx);
      if (NO.test(n)) return onOption(state, "sms:no", undefined, ctx);
      return null;
    case "summary":
      if (YES.test(n)) return onOption(state, "confirm", undefined, ctx);
      if (NO.test(n) || /\b(change|edit)\b/.test(n)) return onOption(state, "change", undefined, ctx);
      return null;
    // A destructive confirm never guesses and never hands the text to the answer bot: anything
    // but a clear yes/no re-asks. ("cancel" here could mean "cancel my place" or "cancel that".)
    case "leaveConfirm":
      if (YES.test(n) || /\bleave\b/.test(n)) return onOption(state, "leave:yes", undefined, ctx);
      if (NO.test(n) || /\bstay\b/.test(n)) return onOption(state, "leave:no", undefined, ctx);
      return { state, out: [{ text: S.didNotCatch }] };
    case "cancelConfirm":
      if (YES.test(n)) return onOption(state, "cancel:yes", undefined, ctx);
      if (NO.test(n) || /\bkeep\b/.test(n)) return onOption(state, "cancel:no", undefined, ctx);
      return { state, out: [{ text: S.didNotCatch }] };
    default:
      return null;
  }
}

// ---- options (taps) ----

function onOption(state: FlowState, id: string, value: unknown, ctx: FlowCtx): StepResult {
  if (id.startsWith("start:")) return start(id.slice(6) as FlowKind, ctx);
  if (id === "done") return { state: idle(), out: [{ text: S.anythingElse, options: starterOptions() }] };
  if (id === "stop" || id === "cancel") return stopped();
  if (id === "continue") return prompt({ ...state, aside: false }, ctx);

  const d = state.draft;
  switch (id) {
    case "visitor:patient":
    case "visitor:mr":
      if (state.step !== "visitor") return ignore(state);
      return advance({ ...state, draft: { ...d, visitorType: id === "visitor:mr" ? "mr" : "patient" } }, ctx);

    case "services": {
      if (state.step !== "services") return ignore(state);
      const known = new Set(ctx.services.map((s) => s.id));
      const ids = (Array.isArray(value) ? value : []).filter((x): x is string => typeof x === "string" && known.has(x));
      const unique = ids.filter((x, i) => ids.indexOf(x) === i);
      if (unique.length === 0) return { state, out: [{ text: S.servicesPickOne }] };
      if (unique.length > ctx.maxServices) {
        return { state, out: [{ text: format(S.servicesTooMany, { max: ctx.maxServices }) }] };
      }
      return advance({ ...state, draft: { ...clearField(d, "services"), serviceIds: unique } }, ctx);
    }

    case "staff": {
      if (state.step !== "staff") return ignore(state);
      const sid = typeof value === "string" ? value : "";
      if (sid !== "any" && !ctx.staff.some((s) => s.id === sid)) {
        return { state, out: [{ text: format(S.staffGone, { name: S.editStaff }) }] };
      }
      return advance({ ...state, draft: { ...clearField(d, "staff"), staffId: sid } }, ctx);
    }

    case "moreDates":
      if (state.step !== "date") return ignore(state);
      return prompt({ ...state, allDays: true }, ctx);

    case "anotherDay":
      return advance({ ...state, draft: clearField(d, "date"), slots: null, slotsKey: null }, ctx);

    case "retrySlots":
      if (state.step !== "time") return ignore(state);
      return prompt(state, ctx);

    case "walkIn": {
      // Booking → the walk-in line, keeping what was already chosen (pop-up switchToWaitlist parity).
      if (ctx.walkInsClosed) return ignore(state);
      const next: FlowState = {
        ...state,
        kind: "join",
        seq: sequence("join", ctx),
        draft: { ...d, date: undefined, slot: undefined },
        slots: null,
        slotsKey: null,
      };
      if (ctx.held) return start("join", ctx);
      return advance(next, ctx, [{ text: format(S.joinIntro, { name: ctx.storeName, wait: waitSentence(ctx) }) }]);
    }

    case "slot": {
      if (state.step !== "time") return ignore(state);
      const hit = state.slots?.find((s) => s.startAt === value);
      if (!hit) return ignore(state);
      return advance({ ...state, draft: { ...d, slot: hit } }, ctx);
    }

    case "name:yes":
      if (state.step !== "name" || !ctx.lastName) return ignore(state);
      return advance({ ...state, draft: { ...d, name: ctx.lastName } }, ctx);
    case "name:other":
      if (state.step !== "name") return ignore(state);
      return prompt({ ...state, askName: true }, ctx);

    case "phone:yes": {
      if (state.step !== "phone") return ignore(state);
      const p = ctx.normalizePhone(ctx.lastPhone);
      if (!p) return prompt({ ...state, askPhone: true }, ctx);
      return advance({ ...state, draft: { ...d, phone: p } }, ctx);
    }
    case "phone:other":
      if (state.step !== "phone") return ignore(state);
      return prompt({ ...state, askPhone: true }, ctx);

    case "sms:yes":
    case "sms:no":
      if (state.step !== "sms") return ignore(state);
      return advance({ ...state, draft: { ...d, sms: id === "sms:yes" } }, ctx);

    case "confirm": {
      if (state.step !== "summary" || (state.kind !== "join" && state.kind !== "book")) return ignore(state);
      // The chat holds no ticket locks, so re-check what may have changed while the customer typed.
      if (state.kind === "join") {
        if (ctx.walkInsClosed) return start("join", ctx);
        return { state, out: [], effect: { type: "preflightJoin", draft: d } };
      }
      return { state, out: [], effect: { type: "preflightBook", draft: d, key: slotsKeyOf(d) } };
    }
    case "change":
      if (state.step !== "summary") return ignore(state);
      return prompt({ ...state, step: "edit" }, ctx);

    case "leave":
      if (!ctx.held) return start("leave", ctx);
      return leaveFromHeld({ ...initialState() }, ctx);
    case "leave:yes":
      if (state.step !== "leaveConfirm") return ignore(state);
      return { state, out: [], effect: { type: "leave" } };
    case "leave:no":
      return { state: idle(), out: [{ text: S.anythingElse, options: starterOptions() }] };

    case "different":
      return start("join", ctx, true);

    case "track:yes": {
      if (state.step !== "trackPhone") return ignore(state);
      const p = ctx.normalizePhone(ctx.lastPhone);
      if (!p) return prompt({ ...state, askPhone: true }, ctx);
      return { state, out: [], effect: { type: "track", phone: p } };
    }
    case "trackOther":
      return prompt({ ...initialState(), kind: "track", step: "trackPhone", askPhone: true, then: state.then }, ctx);

    case "appts:yes": {
      if (state.step !== "apptsPhone") return ignore(state);
      const p = ctx.normalizePhone(ctx.lastPhone);
      if (!p) return prompt({ ...state, askPhone: true }, ctx);
      return { state, out: [{ text: S.apptsChecking }], effect: { type: "lookupAppts", phone: p } };
    }
    case "apptsOther":
      return prompt({ ...initialState(), kind: "appts", step: "apptsPhone", askPhone: true }, ctx);

    case "cancel:yes":
      if (state.step !== "cancelConfirm" || !state.pendingAppt) return ignore(state);
      return { state, out: [], effect: { type: "cancelAppt", id: state.pendingAppt } };
    case "cancel:no":
      return { state: idle(), out: [{ text: S.anythingElse, options: starterOptions() }] };
  }

  if (id.startsWith("day:")) {
    if (state.step !== "date") return ignore(state);
    const ymd = id.slice(4);
    const day = ctx.days.find((x) => x.ymd === ymd);
    if (!day) return ignore(state);
    if (day.closed) {
      return { state, out: [{ text: format(S.slotsClosed, { name: ctx.storeName, day: day.label }) }] };
    }
    return advance({ ...state, draft: { ...clearField(d, "date"), date: ymd } }, ctx);
  }

  if (id.startsWith("edit:")) {
    if (state.step !== "edit") return ignore(state);
    const step = id.slice(5) as FieldStep;
    if (!state.seq.includes(step)) return ignore(state);
    const next: FlowState = {
      ...state,
      draft: clearField(state.draft, step),
      askName: state.askName || step === "name",
      askPhone: state.askPhone || step === "phone",
    };
    return advance(next, ctx);
  }

  if (id.startsWith("cancelAppt:")) {
    const apptId = id.slice(11);
    const appt = state.appts.find((a) => a.appointmentId === apptId);
    if (!appt || !appt.canCancel) return ignore(state);
    const what = [appt.serviceName, ctx.formatWhen(appt.scheduledStartAt)].filter(Boolean).join(", ");
    // Same endpoint either way; a series visit is worded as the skip it becomes.
    return {
      state: { ...state, kind: "appts", step: "cancelConfirm", pendingAppt: apptId },
      out: [
        {
          text: format(appt.repeats ? S.skipConfirm : S.cancelConfirm, { what }),
          options: [
            { id: "cancel:yes", label: appt.repeats ? S.skipYes : S.cancelYes },
            { id: "cancel:no", label: S.cancelNo },
          ],
        },
      ],
    };
  }

  return ignore(state);
}

/** A stale tap (an option from a step already answered) changes nothing and says nothing. */
function ignore(state: FlowState): StepResult {
  return { state, out: [] };
}

function back(state: FlowState, ctx: FlowCtx): StepResult {
  const cur = state.step;
  const order: Step[] = [...state.seq, "summary"];
  const i = cur ? order.indexOf(cur) : -1;
  if (i <= 0) return prompt(state, ctx);
  const prev = order[i - 1] as FieldStep;
  const next: FlowState = {
    ...state,
    draft: clearField(state.draft, prev),
    askName: state.askName || prev === "name",
    askPhone: state.askPhone || prev === "phone",
  };
  return advance(next, ctx);
}

// ---- effect results ----

/**
 * One card per appointment, with Cancel (or "Skip this visit" for a series visit) wherever the page
 * holds the key. There used to be a third branch — booked on another device, "please call the
 * store" — which the 2026-10-05 decision removed: a phone lookup now carries the keys.
 */
function apptOut(appts: ApptView[]): Out[] {
  return appts.map((a) => {
    const cancellable = a.canCancel && (a.status === "confirmed" || a.status === "pending");
    if (cancellable) {
      return {
        card: { type: "appointment", appt: a },
        options: [{ id: `cancelAppt:${a.appointmentId}`, label: a.repeats ? S.skipThis : S.cancelThis }],
      };
    }
    return { card: { type: "appointment", appt: a } };
  });
}

function onResult(state: FlowState, input: Extract<Input, { kind: "result" }>, ctx: FlowCtx): StepResult {
  const e = input.effect;
  const err = input.ok ? null : input.error;
  const data = (input.ok ? input.data : null) as Record<string, unknown> | null;

  switch (e.type) {
    case "fetchSlots": {
      // A newer day / provider / service mix was picked while this was in flight — or the
      // customer has moved on entirely. Its answer is no longer the truth (slotReq parity).
      if (state.step !== "time" || state.slotsKey !== e.key) return { state, out: [] };
      if (err) {
        if (e.silent) return { state, out: [] };
        return {
          state: { ...state, slotsError: true, slots: [] },
          out: [{ text: S.slotsError, options: [{ id: "retrySlots", label: S.retry }, ...timeOptions(state, ctx)] }],
        };
      }
      const slots = ((data?.slots as SlotLite[]) ?? []).slice();
      const next: FlowState = { ...state, slots, slotsError: false };
      if (e.silent || slots.length > 0) return { state: next, out: [] };
      const day = ctx.days.find((x) => x.ymd === e.date);
      return {
        state: next,
        out: [
          {
            text: day?.closed
              ? format(S.slotsClosed, { name: ctx.storeName, day: day.label })
              : format(S.slotsNone, { day: dayLabel(ctx, e.date) }),
          },
        ],
      };
    }

    case "preflightJoin": {
      if (err) return submitFailed(state, err, ctx);
      const staffIds = (data?.staffIds as string[]) ?? [];
      const sid = state.draft.staffId;
      if (sid && sid !== "any" && !staffIds.includes(sid)) {
        const name = ctx.staff.find((s) => s.id === sid)?.name ?? S.editStaff;
        return advance({ ...state, draft: clearField(state.draft, "staff") }, ctx, [{ text: format(S.staffGone, { name }) }]);
      }
      return { state, out: [], effect: { type: "join", draft: state.draft } };
    }

    case "preflightBook": {
      if (err) return submitFailed(state, err, ctx);
      const staffIds = (data?.staffIds as string[]) ?? [];
      const fresh = (data?.slots as SlotLite[]) ?? [];
      const d = state.draft;
      if (d.staffId && d.staffId !== "any" && !staffIds.includes(d.staffId)) {
        const name = ctx.staff.find((s) => s.id === d.staffId)?.name ?? S.editStaff;
        return advance({ ...state, draft: clearField(d, "staff") }, ctx, [{ text: format(S.staffGone, { name }) }]);
      }
      const slot = d.slot;
      const passed = !slot || Date.parse(slot.startAt) <= ctx.now;
      const stillFree = !!slot && fresh.some((s) => s.startAt === slot.startAt);
      if (passed || !stillFree) {
        // Straight back to the time step with the list we just fetched — no second round trip.
        const next: FlowState = {
          ...state,
          step: "time",
          draft: { ...d, slot: undefined },
          slots: fresh,
          slotsKey: slotsKeyOf(d),
          slotsError: false,
        };
        return {
          state: next,
          out: [
            {
              text: passed ? S.slotPassed : S.slotTaken,
              card: { type: "slots", date: d.date ?? "" },
              options: timeOptions(next, ctx),
            },
          ],
        };
      }
      return { state, out: [], effect: { type: "book", draft: d } };
    }

    case "join": {
      if (err) return submitFailed(state, err, ctx);
      const already = !!(data?.alreadyInQueue as boolean | undefined);
      return {
        state: { ...initialState(), kind: "join", step: "result" },
        out: [
          {
            text: already ? S.alreadyIn : S.joined,
            card: { type: "ticket" },
            options: [{ id: "leave", label: S.leaveLine }, { id: "done", label: S.done }],
          },
        ],
      };
    }

    case "book": {
      // The server re-checks the slot under a lock; if someone else got there first (or the time
      // passed), go straight back to fresh times rather than a generic "didn't go through".
      if (err && err.code === "SLOT_UNAVAILABLE") {
        const r = prompt({ ...state, step: "time", draft: { ...state.draft, slot: undefined } }, ctx);
        return { ...r, out: [{ text: S.slotTaken }, ...r.out] };
      }
      if (err) return submitFailed(state, err, ctx);
      const appt = data?.appt as ApptView;
      return {
        state: { ...initialState(), kind: "appts", step: "result", appts: [appt] },
        out: [
          { text: S.booked },
          ...apptOut([appt]),
          { options: [{ id: "start:book", label: S.bookAnother }, { id: "done", label: S.done }] },
        ],
      };
    }

    case "track": {
      if (err) {
        if (err.blocked) return blockedResult(state, ctx);
        return { state, out: [{ text: format(S.submitError, { message: err.message }) }] };
      }
      if (!data?.found) {
        return {
          state: { ...state, step: "result" },
          out: [
            {
              text: format(S.trackNotFound, { phone: ctx.maskPhone(e.type === "track" ? e.phone : "") }),
              options: [
                { id: "start:join", label: S.checkInNow },
                { id: "trackOther", label: S.tryAnother },
              ],
            },
          ],
        };
      }
      const status = String(data.status ?? "waiting");
      const inService = status === "in_service" || !!data.isYourTurn;
      const canLeave = !!data.canLeave;
      if (state.then === "leave") {
        if (!canLeave && status === "waiting" && !inService) {
          return {
            state: { ...initialState(), kind: "leave", step: "result" },
            out: [{ text: S.leaveOtherDevice, card: { type: "ticket" }, options: [...callOption(ctx), { id: "done", label: S.done }] }],
          };
        }
        if (status !== "waiting" || inService) {
          return {
            state: { ...initialState(), kind: "leave", step: "result" },
            out: [{ text: S.leaveInService, card: { type: "ticket" }, options: [{ id: "done", label: S.done }] }],
          };
        }
        return prompt(
          { ...initialState(), kind: "leave", step: "leaveConfirm" },
          { ...ctx, held: { token: String(data.token ?? ""), status, inService, canLeave } },
        );
      }
      return {
        state: { ...initialState(), kind: "track", step: "result" },
        out: [
          {
            text: S.held,
            card: { type: "ticket" },
            options: [
              ...(status === "waiting" && !inService && canLeave ? [{ id: "leave", label: S.leaveLine }] : []),
              { id: "trackOther", label: S.trackOther },
              { id: "done", label: S.done },
            ],
          },
        ],
      };
    }

    case "leave": {
      if (err) {
        // 409 = the owner started the service between the confirm and the tap.
        const text = err.status === 409 ? S.leaveInService : format(S.leaveError, { message: err.message });
        return { state: { ...initialState(), kind: "leave", step: "result" }, out: [{ text, options: [{ id: "done", label: S.done }] }] };
      }
      return {
        state: { ...initialState(), kind: "leave", step: "result" },
        out: [{ text: S.left, options: [{ id: "start:join", label: S.rejoin }, { id: "done", label: S.done }] }],
      };
    }

    case "lookupAppts": {
      const phone = ctx.maskPhone(e.phone);
      if (err) {
        if (err.blocked) return blockedResult(state, ctx);
        return { state, out: [{ text: format(S.submitError, { message: err.message }), options: [{ id: "apptsOther", label: S.tryAnother }] }] };
      }
      const appts = (data?.appts as ApptView[]) ?? [];
      if (appts.length === 0) {
        return {
          state: { ...state, step: "result", appts: [] },
          out: [
            {
              text: format(S.apptsNone, { phone }),
              options: [{ id: "start:book", label: S.bookInstead }, { id: "apptsOther", label: S.tryAnother }],
            },
          ],
        };
      }
      return {
        state: { ...state, kind: "appts", step: "apptsList", appts },
        out: [
          { text: format(S.apptsFound, { phone }) },
          ...apptOut(appts),
          { options: [{ id: "apptsOther", label: S.apptLookupOther }, { id: "done", label: S.done }] },
        ],
      };
    }

    case "cancelAppt": {
      if (err) {
        return {
          state: { ...state, step: "result", pendingAppt: null },
          out: [{ text: format(S.cancelError, { message: err.message }), options: [...callOption(ctx), { id: "done", label: S.done }] }],
        };
      }
      const skippedVisit = !!state.appts.find((a) => a.appointmentId === e.id)?.repeats;
      return {
        state: { ...initialState(), kind: "appts", step: "result" },
        out: [
          {
            text: skippedVisit ? S.skipped : S.cancelled,
            options: [{ id: "start:book", label: S.bookAgain }, { id: "done", label: S.done }],
          },
        ],
      };
    }

    default:
      return { state, out: [] };
  }
}

function submitFailed(state: FlowState, err: FlowError, ctx: FlowCtx): StepResult {
  if (err.blocked) return blockedResult(state, ctx);
  return {
    state: { ...state, step: "summary" },
    out: [
      {
        text: format(S.submitError, { message: err.message }),
        options: [
          { id: "confirm", label: S.retry },
          { id: "change", label: S.change },
          { id: "cancel", label: S.cancel },
        ],
      },
    ],
  };
}

// ---- entry point ----

export function step(state: FlowState, input: Input, ctx: FlowCtx): StepResult {
  switch (input.kind) {
    case "start":
      return start(input.flow, ctx, !!input.fresh);
    case "option":
      // Any tap is an explicit answer — it ends a pending "Shall we carry on?".
      return onOption({ ...state, awaitingContinue: false }, input.id, input.value, ctx);
    case "result":
      return onResult(state, input, ctx);
    case "aside":
      if (!state.kind || !state.aside || state.step === "result") return { state: { ...state, aside: false }, out: [] };
      return {
        state: { ...state, aside: false, awaitingContinue: true },
        out: [{ text: S.continuePrompt, options: [{ id: "continue", label: S.continue }, { id: "stop", label: S.stop }] }],
      };
    case "refresh":
      // Slots have no push event (booking emits nothing), so the time step re-asks on a timer.
      if (state.step !== "time" || !state.draft.date || state.slots === null) return { state, out: [] };
      return {
        state,
        out: [],
        effect: {
          type: "fetchSlots",
          key: slotsKeyOf(state.draft),
          date: state.draft.date,
          serviceIds: state.draft.serviceIds,
          staffId: state.draft.staffId ?? "any",
          silent: true,
        },
      };
    case "text": {
      const n = norm(input.text);
      const active = !!state.kind && state.step !== "result";
      if (active && state.awaitingContinue) {
        // Answering "Shall we carry on?": yes re-shows the step (e.g. the summary with its Confirm
        // button) — it never confirms by itself; the customer confirms afresh after seeing it.
        const resume = { ...state, awaitingContinue: false };
        if (YES.test(n) || CONTINUE.test(n)) return prompt(resume, ctx);
        if (NO.test(n) || STOP.test(n)) return stopped();
        if (BACK.test(n)) return back(resume, ctx);
        return { state: { ...state, aside: true }, out: [], effect: { type: "askServer" } };
      }
      if (active) {
        // At a yes/no confirm, "cancel" is an answer, not "stop the flow".
        const isConfirm = state.step === "cancelConfirm" || state.step === "leaveConfirm";
        if (STOP.test(n) && !isConfirm) return stopped();
        if (BACK.test(n)) return back(state, ctx);
        const r = textForStep(state, input.text, ctx);
        if (r) return r;
        // Not an answer to this step: let the answer bot take it, then offer to carry on.
        return { state: { ...state, aside: true }, out: [], effect: { type: "askServer" } };
      }
      const intent = detectIntent(input.text);
      if (intent) return start(intent, ctx);
      return { state, out: [], effect: { type: "askServer" } };
    }
  }
}
