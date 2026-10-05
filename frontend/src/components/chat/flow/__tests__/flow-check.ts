/**
 * Store-chat guided flows — scenario self-check (docs/customer-chatbot-booking.md §Scenarios).
 *
 * Framework-free, like the theme engine's run.ts and the mobile responsive-check: it runs under the
 * `tsx` backend/ already depends on, so frontend/ gains no test runner (CLAUDE.md §12.6).
 *
 *   npm run test:chat-flow
 *   # or: cd backend && npx tsx ../frontend/src/components/chat/flow/__tests__/flow-check.ts
 *
 * It drives the pure state machine (engine.ts) through every engine-reachable row of the scenario
 * matrix. What it does NOT cover, and why: the network (the backend's own unit tests and
 * backend/scripts/smoke-selfservice.mjs cover the endpoints the effects call), and rendering + live
 * socket messages (no browser runner exists — the Tier-2 gap; those rows are manual QA).
 *
 * Failures are counted and printed; a non-zero exit code is the signal.
 */

import {
  detectIntent,
  initialState,
  matchSlot,
  slotsKeyOf,
  step,
  type Effect,
  type FlowCtx,
  type FlowState,
  type Input,
  type Out,
  type SlotLite,
  type StepResult,
} from "../engine";
import { maskPhone, parseTypedPhone } from "../phone";
import en from "../../../../i18n/en.json";

const S = en.chat.flow;
let pass = 0;
let fail = 0;
function check(cond: unknown, msg: string) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log(`  ✗ ${msg}`);
  }
}
function section(name: string) {
  console.log(name);
}

// ---- fixtures ----

const NOW = Date.parse("2026-10-05T04:30:00.000Z"); // Mon 5 Oct 2026, 10:00 IST
// 14 days from Monday 5 Oct; Sundays closed.
const DAYS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 5 + i, 12));
  const ymd = d.toISOString().slice(0, 10);
  return { ymd, label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : ymd, closed: d.getUTCDay() === 0 };
});
const TODAY = DAYS[0].ymd;
const TOMORROW = DAYS[1].ymd;
const SUNDAY = DAYS.find((d) => d.closed)!.ymd;

const SLOTS: SlotLite[] = [
  { startAt: "2026-10-06T05:30:00.000Z", label: "11:00 AM" },
  { startAt: "2026-10-06T11:30:00.000Z", label: "5:00 PM" },
  { startAt: "2026-10-06T12:00:00.000Z", label: "5:30 PM" },
];

function ctxWith(over: Partial<FlowCtx> = {}): FlowCtx {
  return {
    storeName: "Sharp Cuts",
    isHospital: false,
    services: [
      { id: "s1", name: "Haircut" },
      { id: "s2", name: "Beard Trim" },
      { id: "s3", name: "Hair Spa" },
    ],
    staff: [
      { id: "st1", name: "John" },
      { id: "st2", name: "Lisa" },
    ],
    walkInsClosed: false,
    nextOpenLabel: null,
    waitMinutes: 12,
    days: DAYS,
    held: null,
    lastName: "",
    lastPhone: "",
    hasPhone: true,
    maxServices: 10,
    now: NOW,
    isBlocked: () => false,
    normalizePhone: (raw) => parseTypedPhone(raw, "91"),
    maskPhone,
    formatWhen: (iso) => iso,
    ...over,
  };
}

// ---- tiny driver ----

class Flow {
  state: FlowState = initialState();
  last: StepResult = { state: initialState(), out: [] };
  constructor(public ctx: FlowCtx) {}
  send(input: Input): StepResult {
    this.last = step(this.state, input, this.ctx);
    this.state = this.last.state;
    return this.last;
  }
  start(flow: "join" | "book" | "track" | "leave" | "appts", fresh = false) {
    return this.send({ kind: "start", flow, fresh });
  }
  opt(id: string, value?: unknown) {
    return this.send({ kind: "option", id, value });
  }
  text(text: string) {
    return this.send({ kind: "text", text });
  }
  ok(data: unknown) {
    const effect = this.last.effect as Effect;
    return this.send({ kind: "result", effect, ok: true, data });
  }
  err(status: number, code: string, message: string, blocked = false) {
    const effect = this.last.effect as Effect;
    return this.send({ kind: "result", effect, ok: false, error: { status, code, message, blocked } });
  }
}

const texts = (out: Out[]) => out.map((o) => o.text ?? "").join(" | ");
const optionIds = (out: Out[]) => out.flatMap((o) => (o.options ?? []).map((x) => x.id));
const cards = (out: Out[]) => out.map((o) => o.card?.type).filter(Boolean);
const has = (out: Out[], s: string) => texts(out).includes(s);

// =====================================================================================
section("1. full check-in (open store, services + staff)");
{
  const f = new Flow(ctxWith());
  let r = f.start("join");
  check(has(r.out, "Let’s check you in at Sharp Cuts") && has(r.out, "about 12 min"), "intro quotes the live wait");
  check(f.state.step === "services" && cards(r.out).includes("services"), "first question is services");
  r = f.opt("services", ["s1", "s2"]);
  check(f.state.step === "staff" && cards(r.out).includes("staff"), "then the live staff picker");
  r = f.opt("staff", "st2");
  check(f.state.step === "name" && has(r.out, S.nameQuestion), "no remembered name → asks for it");
  r = f.text("Riya");
  check(f.state.step === "phone" && has(r.out, S.phoneQuestion), "then the phone");
  r = f.text("98765 43210");
  check(f.state.draft.phone === "+919876543210", "a local number is read in the store's country");
  check(f.state.step === "sms" && cards(r.out).includes("consent"), "then SMS consent with the full disclosure");
  r = f.opt("sms:no");
  check(f.state.step === "summary" && cards(r.out).includes("summary"), "then the summary");
  check(optionIds(r.out).join(",") === "confirm,change,cancel", "summary offers confirm / change / cancel");
  r = f.opt("confirm");
  check(r.effect?.type === "preflightJoin" && r.out.length === 0, "confirm re-checks staff first");
  r = f.ok({ staffIds: ["st1", "st2"] });
  const eff = r.effect;
  check(eff?.type === "join", "…then joins");
  if (eff?.type === "join") {
    check(eff.draft.serviceIds.join() === "s1,s2", "services in pick order");
    check(eff.draft.staffId === "st2" && eff.draft.name === "Riya" && eff.draft.sms === false, "staff, name, consent carried");
  }
  r = f.ok({ alreadyInQueue: false });
  check(has(r.out, S.joined) && cards(r.out).includes("ticket"), "success shows the live ticket card");
  check(optionIds(r.out).includes("leave"), "…with Leave on it");
  check(f.state.step === "result", "flow finished");
}

section("2. full booking (remembered name + number)");
{
  const f = new Flow(ctxWith({ lastName: "Riya", lastPhone: "+919876543210" }));
  let r = f.start("book");
  check(f.state.step === "services", "services first");
  f.opt("services", ["s1"]);
  r = f.opt("staff", "any");
  check(f.state.step === "date", "then the day");
  const ids = optionIds(r.out);
  check(ids.filter((x) => x.startsWith("day:")).length === 7 && ids.includes("moreDates"), "7 days + More dates");
  const sundayOpt = r.out.flatMap((o) => o.options ?? []).find((o) => o.id === `day:${SUNDAY}`);
  check(sundayOpt?.disabled === true, "a closed weekday is disabled");
  r = f.opt(`day:${TOMORROW}`);
  check(f.state.step === "time" && r.effect?.type === "fetchSlots", "picking a day loads its slots");
  check(f.state.slots === null, "slots show as loading");
  r = f.ok({ slots: SLOTS });
  check(f.state.slots?.length === 3 && r.out.length === 0, "slots land silently in the live card");
  r = f.opt("slot", SLOTS[1].startAt);
  check(f.state.step === "name" && optionIds(r.out).includes("name:yes"), "remembered name is offered");
  r = f.opt("name:yes");
  check(optionIds(r.out).includes("phone:yes") && has(r.out, "+91 98••••••10"), "remembered number is offered, masked");
  f.opt("phone:yes");
  r = f.opt("sms:yes");
  check(f.state.draft.sms === true && f.state.step === "summary", "consent recorded → summary");
  r = f.opt("confirm");
  check(r.effect?.type === "preflightBook", "confirm re-checks the slot first");
  r = f.ok({ staffIds: ["st1", "st2"], slots: SLOTS });
  check(r.effect?.type === "book", "still free → books");
  r = f.ok({
    appt: { appointmentId: "a1", serviceName: "Haircut", staffName: null, scheduledStartAt: SLOTS[1].startAt, status: "confirmed", canCancel: true },
  });
  check(has(r.out, S.booked) && cards(r.out).includes("appointment"), "booked card shown");
  check(optionIds(r.out).includes("cancelAppt:a1"), "…with Cancel this appointment");
}

section("2b. More dates shows the full two weeks");
{
  const f = new Flow(ctxWith({ services: [], staff: [] }));
  f.start("book");
  const r = f.opt("moreDates");
  check(optionIds(r.out).filter((x) => x.startsWith("day:")).length === 14, "14 days after More dates");
}

section("3/4. optional steps follow the store");
{
  const hosp = new Flow(ctxWith({ isHospital: true }));
  hosp.start("join");
  check(hosp.state.step === "visitor", "Hospital asks visitor type first");
  hosp.text("patient");
  check(hosp.state.draft.visitorType === "patient", "typed 'patient' answers it");

  const bare = new Flow(ctxWith({ services: [], staff: [] }));
  bare.start("join");
  check(bare.state.step === "name", "no services, no staff → straight to name");
  const bareBook = new Flow(ctxWith({ services: [], staff: [] }));
  bareBook.start("book");
  check(bareBook.state.step === "date", "booking with no services/staff → straight to the day");
}

section("5/6. closed store");
{
  const f = new Flow(ctxWith({ walkInsClosed: true, nextOpenLabel: "tomorrow at 10:00 AM" }));
  const r = f.start("join");
  check(has(r.out, "opens tomorrow at 10:00 AM"), "closed → says when it opens");
  check(optionIds(r.out).includes("start:book") && f.state.step === "result", "offers booking instead, asks nothing");
  const open = new Flow(ctxWith({ walkInsClosed: false }));
  open.start("join");
  check(open.state.step === "services", "not closed (incl. a store with no hours) → check-in allowed");
}

section("7. closed day chosen anyway");
{
  const f = new Flow(ctxWith({ services: [], staff: [] }));
  f.start("book");
  const r = f.opt(`day:${SUNDAY}`);
  check(f.state.step === "date" && has(r.out, "closed on"), "stays on the day step, says it is closed");
}

section("8. no slots / walk-in fallback");
{
  const f = new Flow(ctxWith({ services: [], staff: [] }));
  f.start("book");
  let r = f.opt(`day:${TODAY}`);
  check(optionIds(r.out).includes("walkIn"), "today + open → walk-in fallback offered");
  r = f.ok({ slots: [] });
  check(has(r.out, "No times left on Today"), "empty day says so");

  const g = new Flow(ctxWith({ services: [], staff: [] }));
  g.start("book");
  r = g.opt(`day:${TOMORROW}`);
  check(!optionIds(r.out).includes("walkIn"), "another day → no walk-in fallback");

  const h = new Flow(ctxWith({ services: [], staff: [], walkInsClosed: true }));
  h.start("book");
  r = h.opt(`day:${TODAY}`);
  check(!optionIds(r.out).includes("walkIn"), "closed now → no walk-in fallback even for today");

  // Taking the fallback keeps the details and becomes a check-in.
  const k = new Flow(ctxWith({ staff: [] }));
  k.start("book");
  k.opt("services", ["s3"]);
  k.opt(`day:${TODAY}`);
  r = k.opt("walkIn");
  check(k.state.kind === "join" && k.state.draft.serviceIds.join() === "s3" && !k.state.draft.date, "walk-in keeps services, drops the day");
}

section("10/11/12. pre-flight catches what changed while typing");
{
  const mk = () => {
    const f = new Flow(ctxWith({ services: [], lastName: "Riya", lastPhone: "+919876543210" }));
    f.start("book");
    f.opt("staff", "st2");
    f.opt(`day:${TOMORROW}`);
    f.ok({ slots: SLOTS });
    f.opt("slot", SLOTS[1].startAt);
    f.opt("name:yes");
    f.opt("phone:yes");
    f.opt("sms:no");
    f.opt("confirm");
    return f;
  };
  let f = mk();
  let r = f.ok({ staffIds: ["st1"], slots: SLOTS });
  check(has(r.out, "Lisa is no longer available") && f.state.step === "staff", "deactivated staff → re-pick");
  check(!f.state.draft.slot, "…and the time chosen for them is cleared");

  f = mk();
  r = f.ok({ staffIds: ["st1", "st2"], slots: [SLOTS[0], SLOTS[2]] });
  check(has(r.out, S.slotTaken) && f.state.step === "time", "slot taken → back to times");
  check(f.state.slots?.length === 2 && !f.state.draft.slot, "…showing the fresh list, time cleared");
  r = f.opt("slot", SLOTS[2].startAt);
  check(f.state.step === "summary", "re-picking goes straight back to the summary (name etc. kept)");

  f = mk();
  f.ctx = ctxWith({ services: [], now: Date.parse(SLOTS[1].startAt) + 60_000 });
  r = f.ok({ staffIds: ["st1", "st2"], slots: SLOTS });
  check(has(r.out, S.slotPassed), "slot time passed → says so");

  // Join pre-flight too.
  const j = new Flow(ctxWith({ services: [], lastName: "A", lastPhone: "+919876543210" }));
  j.start("join");
  j.opt("staff", "st1");
  j.opt("name:yes");
  j.opt("phone:yes");
  j.opt("sms:no");
  j.opt("confirm");
  r = j.ok({ staffIds: ["st2"] });
  check(has(r.out, "John is no longer available") && j.state.step === "staff", "check-in pre-flight re-picks a vanished stylist");
}

section("13. changing services after picking a time");
{
  const f = new Flow(ctxWith({ staff: [], lastName: "Riya", lastPhone: "+919876543210" }));
  f.start("book");
  f.opt("services", ["s1"]);
  f.opt(`day:${TOMORROW}`);
  const oldKey = f.state.slotsKey;
  f.ok({ slots: SLOTS });
  f.opt("slot", SLOTS[0].startAt);
  f.opt("name:yes");
  f.opt("phone:yes");
  f.opt("sms:no");
  f.opt("change");
  let r = f.opt("edit:services");
  check(f.state.step === "services" && f.state.draft.serviceIds.length === 0 && !f.state.draft.slot, "services cleared with the time");
  r = f.opt("services", ["s1", "s3"]);
  check(f.state.step === "time" && r.effect?.type === "fetchSlots", "→ times for the NEW length are fetched");
  check(f.state.draft.name === "Riya" && f.state.draft.date === TOMORROW, "name and day survive");
  // A late answer for the old service mix must not paint the new list.
  r = f.send({ kind: "result", effect: { type: "fetchSlots", key: oldKey!, date: TOMORROW, serviceIds: ["s1"], staffId: "any", silent: false }, ok: true, data: { slots: [SLOTS[0]] } });
  check(f.state.slots === null, "stale slot response ignored");
}

section("14/15/16/17. held ticket, duplicates, different number");
{
  const held = { token: "A-7", status: "waiting", inService: false, canLeave: true };
  const f = new Flow(ctxWith({ held }));
  let r = f.start("join");
  check(has(r.out, S.held) && cards(r.out).includes("ticket"), "held → shows the live ticket");
  check(optionIds(r.out).includes("leave") && optionIds(r.out).includes("different"), "…with Leave and Different number");

  const b = new Flow(ctxWith({ held }));
  b.start("book");
  check(b.state.step === "services", "held ticket does NOT block booking");

  const d = new Flow(ctxWith({ services: [], staff: [] }));
  d.start("join");
  d.text("Riya");
  d.text("9876543210");
  d.opt("sms:no");
  d.opt("confirm");
  d.ok({ staffIds: [] });
  r = d.ok({ alreadyInQueue: true });
  check(has(r.out, S.alreadyIn), "server dedup → 'already on the waitlist'");

  const g = new Flow(ctxWith({ held, services: [], staff: [], lastName: "Riya", lastPhone: "+919876543210" }));
  g.start("join");
  r = g.opt("different");
  check(g.state.step === "name" && has(r.out, S.nameQuestion), "different number asks for a new name (no 'Continue as')");
  g.text("Kiran");
  check(has(g.last.out, S.phoneQuestion), "…and a new number");
}

section("18. blocked number");
{
  const f = new Flow(ctxWith({ lastPhone: "+919876543210", isBlocked: () => true }));
  let r = f.start("join");
  check(has(r.out, S.blocked) && optionIds(r.out).includes("call"), "blocked → call the store");
  check(optionIds(r.out).includes("start:book"), "…and still offers booking (the block is for the walk-in line)");
  const b = new Flow(ctxWith({ lastPhone: "+919876543210", isBlocked: () => true }));
  r = b.start("book");
  check(!has(r.out, S.blocked) && b.state.step === "services", "a blocked number CAN book (QA / user report)");
  const noPhone = new Flow(ctxWith({ lastPhone: "+919876543210", isBlocked: () => true, hasPhone: false }));
  r = noPhone.start("join");
  check(!optionIds(r.out).includes("call"), "no store number → no Call option");

  const e = new Flow(ctxWith({ services: [], staff: [] }));
  e.start("join");
  e.text("Riya");
  e.text("9876543210");
  e.opt("sms:no");
  e.opt("confirm");
  e.ok({ staffIds: [] });
  r = e.err(429, "BLOCKED", "x", true);
  check(has(r.out, S.blocked), "submit blocked → blocked message");
}

section("19/20. leave");
{
  const f = new Flow(ctxWith({ held: { token: "A-7", status: "waiting", inService: false, canLeave: true } }));
  let r = f.start("leave");
  check(f.state.step === "leaveConfirm" && has(r.out, "A-7"), "leave asks to confirm, naming the token");
  r = f.opt("leave:yes");
  check(r.effect?.type === "leave", "confirm → leave");
  r = f.ok({});
  check(has(r.out, S.left) && optionIds(r.out).includes("start:join"), "left → Rejoin offered");

  const s = new Flow(ctxWith({ held: { token: "A-7", status: "in_service", inService: true, canLeave: true } }));
  r = s.start("leave");
  check(has(r.out, S.leaveInService) && !r.effect, "being served → cannot leave");

  const race = new Flow(ctxWith({ held: { token: "A-7", status: "waiting", inService: false, canLeave: true } }));
  race.start("leave");
  race.opt("leave:yes");
  r = race.err(409, "INVALID_STATE", "Cannot leave queue while service is in progress");
  check(has(r.out, S.leaveInService), "owner started service mid-tap (409) → explained");

  const typed = new Flow(ctxWith({ held: { token: "A-7", status: "waiting", inService: false, canLeave: true } }));
  typed.start("leave");
  r = typed.text("cancel");
  check(
    r.effect === undefined && typed.state.step === "leaveConfirm" && has(r.out, S.didNotCatch),
    "an ambiguous 'cancel' at the leave confirm re-asks — it neither leaves nor stops",
  );
}

section("23. waitlist status");
{
  const f = new Flow(ctxWith({ lastPhone: "+919876543210" }));
  let r = f.start("track");
  check(optionIds(r.out).includes("track:yes"), "offers the remembered number");
  r = f.opt("track:yes");
  check(r.effect?.type === "track" && r.effect.phone === "+919876543210", "looks it up");
  r = f.ok({ found: true, status: "waiting", token: "A-9" });
  check(has(r.out, S.held) && cards(r.out).includes("ticket") && !optionIds(r.out).includes("leave"),
    "found by phone lookup → live card, but NO Leave (no ticket key — QA: a stranger removed a place)");
  const own = new Flow(ctxWith({ lastPhone: "+919876543210" }));
  own.start("track"); own.opt("track:yes");
  r = own.ok({ found: true, status: "waiting", token: "A-9", canLeave: true });
  check(optionIds(r.out).includes("leave"), "the browser holding the key still gets Leave");

  const n = new Flow(ctxWith());
  r = n.start("track");
  check(has(r.out, S.trackQuestion), "no remembered number → asks");
  r = n.text("12");
  check(has(r.out, S.phoneInvalid) && n.state.step === "trackPhone", "invalid number → asks again");
  r = n.text("+91 98765 43210");
  r = n.ok({ found: false });
  check(has(r.out, "isn’t on today’s waitlist") && optionIds(r.out).includes("start:join"), "not found → Check in now");
  r = n.opt("trackOther");
  check(n.state.step === "trackPhone" && has(r.out, S.trackQuestion), "try another number → asks (no confirm)");

  const h = new Flow(ctxWith({ held: { token: "A-7", status: "waiting", inService: false, canLeave: true } }));
  r = h.start("track");
  check(cards(r.out).includes("ticket") && !r.effect, "held → shows it without a lookup");

  const lv = new Flow(ctxWith());
  r = lv.start("leave");
  check(has(r.out, S.leaveFindFirst) && lv.state.step === "trackPhone", "leave with nothing held → find it first");
  lv.text("9876543210");
  r = lv.ok({ found: true, status: "waiting", token: "A-3" });
  check(has(r.out, S.leaveOtherDevice) && !r.effect && lv.state.step === "result", "…found without a key → cannot leave from here");
  const lk = new Flow(ctxWith());
  lk.start("leave"); lk.text("9876543210");
  r = lk.ok({ found: true, status: "waiting", token: "A-3", canLeave: true });
  check(lk.state.step === "leaveConfirm" && has(r.out, "A-3"), "…found WITH the key → straight to the leave confirm");
}

section("24/25/26. my appointments");
{
  const mine = { appointmentId: "a1", serviceName: "Haircut", staffName: "Lisa", scheduledStartAt: SLOTS[0].startAt, status: "confirmed", canCancel: true };
  // Number first, like waitlist status (2026-10-05): with a last number it asks "Use +91…?" and
  // lists only that number's bookings. Nothing is listed from this browser, however many numbers
  // booked here.
  const f = new Flow(ctxWith({ lastPhone: "+919876543210" }));
  let r = f.start("appts");
  check(!r.effect && optionIds(r.out).includes("appts:yes") && optionIds(r.out).includes("apptsOther"),
    "starts by asking which number — Use +91…? / a different number — and lists nothing yet");
  r = f.opt("appts:yes");
  check(r.effect?.type === "lookupAppts" && r.effect.phone === "+919876543210", "Yes → looks up that number only");
  r = f.ok({ appts: [mine] });
  check(cards(r.out).includes("appointment") && optionIds(r.out).includes("cancelAppt:a1"), "listed with Cancel");
  r = f.opt("cancelAppt:a1");
  check(f.state.step === "cancelConfirm" && has(r.out, "Cancel Haircut"), "asks to confirm");
  r = f.opt("cancel:yes");
  check(r.effect?.type === "cancelAppt" && r.effect.id === "a1", "cancels that one");
  r = f.ok({});
  check(has(r.out, S.cancelled) && optionIds(r.out).includes("start:book"), "cancelled → Book another time");

  // "A different number" → asks for it, and looks up only that one.
  const other = new Flow(ctxWith({ lastPhone: "+919876543210" }));
  other.start("appts");
  r = other.opt("apptsOther");
  check(!r.effect && other.state.step === "apptsPhone" && has(r.out, S.apptsNoneSaved), "a different number → asks for it");
  r = other.text("9811122233");
  check(r.effect?.type === "lookupAppts" && r.effect.phone === "+919811122233", "…and looks up that number");

  // Client decision 2026-10-05 (docs/customer-my-appointments.md): the phone number alone is enough.
  // The lookup now carries each booking's key, so a booking made on another device is cancellable
  // here — this scenario used to end in "booked elsewhere → call the store".
  const o = new Flow(ctxWith({ lastPhone: "+919876543210" }));
  r = o.start("appts");
  check(optionIds(r.out).includes("appts:yes"), "asks which number");
  r = o.opt("appts:yes");
  check(r.effect?.type === "lookupAppts" && r.effect.phone === "+919876543210", "looks up by phone, as +<cc><number>");
  r = o.ok({ appts: [mine] });
  check(optionIds(r.out).includes("cancelAppt:a1") && !optionIds(r.out).includes("call"),
    "booked elsewhere → cancellable (the lookup handed over the key), no 'call the store'");
  check(!r.out.some((x) => x.text?.includes("another device")), "…and no 'booked on another device' line");
  r = o.opt("cancelAppt:a1");
  check(o.state.step === "cancelConfirm" && has(r.out, "Cancel Haircut"), "lookup → cancel asks to confirm");
  r = o.opt("cancel:yes");
  check(r.effect?.type === "cancelAppt" && r.effect.id === "a1", "lookup → cancel effect for that booking");
  r = o.ok({});
  check(has(r.out, S.cancelled), "…cancelled");

  // A row the page holds no key for is one the API would refuse anyway (it has started).
  const started = new Flow(ctxWith({ lastPhone: "+919876543210" }));
  started.start("appts");
  started.opt("appts:yes");
  r = started.ok({ appts: [{ ...mine, canCancel: false }] });
  check(cards(r.out).includes("appointment") && !optionIds(r.out).includes("cancelAppt:a1"), "no key → shown, no Cancel");
  r = started.opt("cancelAppt:a1");
  check(!r.effect && r.out.length === 0, "a forged cancel tap does nothing");

  // One visit of a repeating booking: same endpoint, worded as the skip the API records.
  const visit = { ...mine, appointmentId: "a2", repeats: true };
  const sv = new Flow(ctxWith({ lastPhone: "+919876543210" }));
  sv.start("appts");
  sv.opt("appts:yes");
  r = sv.ok({ appts: [mine, visit] });
  const labels = r.out.flatMap((x) => x.options ?? []).map((x) => `${x.id}=${x.label}`);
  check(labels.includes(`cancelAppt:a2=${S.skipThis}`) && labels.includes(`cancelAppt:a1=${S.cancelThis}`),
    `series visit → "Skip this visit", one-off → "Cancel this appointment" (got ${labels.join(", ")})`);
  r = sv.opt("cancelAppt:a2");
  check(has(r.out, "Skip Haircut") && has(r.out, "stays booked") && optionIds(r.out).includes("cancel:yes"), "skip asks to confirm, as a skip");
  check(r.out.some((x) => x.options?.some((p) => p.id === "cancel:yes" && p.label === S.skipYes)), "…with 'Yes, skip it'");
  r = sv.opt("cancel:yes");
  check(r.effect?.type === "cancelAppt" && r.effect.id === "a2", "skip → the same cancel effect");
  r = sv.ok({});
  check(has(r.out, S.skipped) && !has(r.out, S.cancelled), "…answered as a skipped visit");

  const e = new Flow(ctxWith({ lastPhone: "+919876543210" }));
  e.start("appts");
  e.opt("appts:yes");
  e.ok({ appts: [mine] });
  e.opt("cancelAppt:a1");
  e.opt("cancel:yes");
  r = e.err(422, "INVALID_STATE_TRANSITION", "This appointment can't be cancelled any more");
  check(has(r.out, "can't be cancelled any more"), "422 → the server's reason");

  const none = new Flow(ctxWith());
  r = none.start("appts");
  check(!r.effect && has(r.out, S.apptsNoneSaved), "no last number → asks for one, lists nothing");
  none.text("9876543210");
  r = none.ok({ appts: [] });
  check(has(r.out, "No upcoming appointments") && optionIds(r.out).includes("start:book"), "none → Book instead");
}

section("27. validation");
{
  const f = new Flow(ctxWith({ services: [], staff: [] }));
  f.start("join");
  let r = f.text("12345");
  check(has(r.out, S.nameInvalid) && f.state.step === "name", "digits are not a name");
  r = f.text("x".repeat(81));
  check(has(r.out, S.nameInvalid), "81 chars is too long");
  f.text("Riya");
  r = f.text("555");
  check(has(r.out, S.phoneInvalid) && f.state.step === "phone", "short number rejected");
  const g = new Flow(ctxWith({ maxServices: 2 }));
  g.start("join");
  r = g.opt("services", ["s1", "s2", "s3"]);
  check(has(r.out, "up to 2") && g.state.step === "services", "over the service cap");
  r = g.opt("services", ["nope"]);
  check(has(r.out, S.servicesPickOne), "unknown ids are dropped, not trusted");
}

section("28. typing inside a flow");
{
  const f = new Flow(ctxWith({ lastName: "Riya", lastPhone: "+919876543210" }));
  f.start("book");
  let r = f.text("haircut and beard trim");
  check(f.state.draft.serviceIds.sort().join() === "s1,s2", "typed services matched");
  r = f.text("lisa");
  check(f.state.draft.staffId === "st2", "typed staff matched");
  r = f.text("tomorrow");
  check(f.state.draft.date === TOMORROW, "typed day matched");
  f.ok({ slots: SLOTS });
  r = f.text("5:30 pm");
  check(f.state.draft.slot?.label === "5:30 PM", "typed time matched");
  r = f.text("back");
  check(f.state.step === "time" && !f.state.draft.slot, "'back' re-asks the time");
  check(r.effect?.type === "fetchSlots", "…with a fresh slot list");
  f.ok({ slots: SLOTS });
  f.text("5pm");
  r = f.text("yes");
  check(f.state.draft.name === "Riya", "'yes' accepts the remembered name");
  f.text("yes");
  r = f.text("do you have parking?");
  check(r.effect?.type === "askServer" && f.state.aside, "an off-flow question goes to the answer bot");
  r = f.send({ kind: "aside" });
  check(optionIds(r.out).join() === "continue,stop", "…then offers to carry on");
  r = f.opt("continue");
  check(f.state.step === "sms" && cards(r.out).includes("consent"), "Continue re-asks the current step");
  r = f.text("stop");
  check(f.state.kind === null && optionIds(r.out).includes("start:join"), "'stop' ends the flow, back to the menu");

  // Stale taps.
  const g = new Flow(ctxWith());
  g.start("join");
  r = g.opt("slot", SLOTS[0].startAt);
  check(r.out.length === 0 && g.state.step === "services", "an option from another step is ignored");
}

section("28b. local intents (never spend the chat allowance)");
{
  const yes: [string, string][] = [
    ["I want to check in", "join"],
    ["join the queue", "join"],
    ["book an appointment", "book"],
    ["Can I book for tomorrow?", "book"],
    ["cancel my appointment", "appts"],
    ["show my bookings", "appts"],
    ["leave the queue", "leave"],
    ["cancel my token", "leave"],
    ["Check Waitlist Status", "track"],
    ["where am i in line", "track"],
  ];
  for (const [msg, want] of yes) check(detectIntent(msg) === want, `"${msg}" → ${want} (got ${detectIntent(msg)})`);
  const no = ["How does waitlist work?", "Walk-ins?", "Hours?", "Do you take walk-ins", "What does a haircut cost?", "is Lisa in today?"];
  for (const msg of no) check(detectIntent(msg) === null, `"${msg}" stays a question (got ${detectIntent(msg)})`);
  const idle = new Flow(ctxWith());
  const r = idle.text("what are your hours?");
  check(r.effect?.type === "askServer" && idle.state.kind === null, "a question while idle → answer bot");
}

section("29. failures are recoverable");
{
  const f = new Flow(ctxWith({ services: [], staff: [] }));
  f.start("book");
  f.opt(`day:${TOMORROW}`);
  let r = f.err(0, "NETWORK", "offline");
  check(has(r.out, S.slotsError) && optionIds(r.out).includes("retrySlots"), "slot load failure → Try again");
  r = f.opt("retrySlots");
  check(r.effect?.type === "fetchSlots", "Try again refetches");

  const j = new Flow(ctxWith({ services: [], staff: [] }));
  j.start("join");
  j.text("Riya");
  j.text("9876543210");
  j.opt("sms:no");
  j.opt("confirm");
  j.ok({ staffIds: [] });
  r = j.err(0, "NETWORK", "Couldn’t reach");
  check(has(r.out, "didn’t go through") && optionIds(r.out).includes("confirm"), "join failure → retry keeps the details");
  check(j.state.step === "summary" && j.state.draft.name === "Riya", "…nothing re-asked");
}

section("P1 regressions (manual QA, 30 Sep 2026)");
{
  // Fix 2: "yes" after an off-topic question must not confirm.
  const mk = () => {
    const f = new Flow(ctxWith({ services: [], staff: [], lastName: "Riya", lastPhone: "+919876543210" }));
    f.start("book");
    f.opt(`day:${TOMORROW}`);
    f.ok({ slots: SLOTS });
    f.opt("slot", SLOTS[1].startAt);
    f.opt("name:yes");
    f.opt("phone:yes");
    f.opt("sms:no");
    return f;
  };
  let f = mk();
  check(f.state.step === "summary", "reached the summary");
  let r = f.text("what are your timings?");
  check(r.effect?.type === "askServer", "off-topic question → answer bot");
  r = f.send({ kind: "aside" });
  check(optionIds(r.out).join() === "continue,stop" && f.state.awaitingContinue, "→ Shall we carry on?");
  r = f.text("yes");
  check(!r.effect && cards(r.out).includes("summary") && optionIds(r.out).includes("confirm"),
    '"yes" to "carry on" re-shows the summary — it does NOT confirm');
  r = f.text("yes");
  check(r.effect?.type === "preflightBook", 'a fresh "yes" at the re-shown summary confirms');

  f = mk();
  f.text("what are your timings?"); f.send({ kind: "aside" });
  r = f.text("no");
  check(f.state.kind === null && !r.effect, '"no" to "carry on" stops, books nothing');

  f = mk();
  f.text("do you take UPI?"); f.send({ kind: "aside" });
  r = f.opt("continue");
  check(cards(r.out).includes("summary") && !f.state.awaitingContinue, "Continue button re-shows the summary");

  // Fix 1/4/5: the server refuses a slot someone else just took.
  f = mk();
  f.opt("confirm");
  f.ok({ staffIds: [], slots: SLOTS });
  r = f.err(409, "SLOT_UNAVAILABLE", "That time is no longer available.");
  check(f.state.step === "time" && r.effect?.type === "fetchSlots" && has(r.out, S.slotTaken) && !f.state.draft.slot,
    "server 409 SLOT_UNAVAILABLE → back to fresh times, not a generic error");

  // Fix 3: a place held without the key can't be left from here.
  const noKey = { token: "A-4", status: "waiting", inService: false, canLeave: false };
  const g = new Flow(ctxWith({ held: noKey }));
  r = g.start("join");
  check(!optionIds(r.out).includes("leave"), "key-less held ticket → no Leave on the card");
  r = g.opt("leave");
  check(has(r.out, S.leaveOtherDevice) && !r.effect, "Leave from a key-less hold → explained, nothing sent");
  const t2 = new Flow(ctxWith({ held: noKey }));
  r = t2.start("leave");
  check(has(r.out, S.leaveOtherDevice) && optionIds(r.out).includes("call"), "…with Call the store");
}

section("live slots: periodic refresh");
{
  const f = new Flow(ctxWith({ services: [], staff: [] }));
  f.start("book");
  const firstLoad = f.opt(`day:${TOMORROW}`).effect as Effect;
  let r = f.send({ kind: "refresh" });
  check(!r.effect, "no refresh while the first load is still in flight");
  f.send({ kind: "result", effect: firstLoad, ok: true, data: { slots: SLOTS } });
  check(f.state.slots?.length === 3, "the first load still lands");
  r = f.send({ kind: "refresh" });
  check(r.effect?.type === "fetchSlots" && r.effect.silent, "time step → silent refetch");
  r = f.ok({ slots: [SLOTS[2]] });
  check(f.state.slots?.length === 1 && r.out.length === 0, "a slot someone else took disappears, silently");
  f.opt("slot", SLOTS[2].startAt);
  r = f.send({ kind: "refresh" });
  check(!r.effect, "no refresh once past the time step");
}

section("helpers");
{
  check(slotsKeyOf({ serviceIds: ["a", "b"], date: "2026-10-06", staffId: "x" }) === "2026-10-06|a,b|x", "slots key");
  check(matchSlot("11", SLOTS)?.label === "11:00 AM", "bare '11' finds 11 AM when there is no 11 PM");
  check(matchSlot("17:00", SLOTS)?.label === "5:00 PM", "24h time");
  check(matchSlot("9pm", SLOTS) === null, "no such slot");
  check(parseTypedPhone("09876543210", "91") === "+919876543210", "trunk 0 dropped");
  check(parseTypedPhone("+1 415 555 2671", "91") === "+14155552671", "explicit + keeps its own country");
  check(parseTypedPhone("hello", "91") === null, "not a number");
  check(maskPhone("+919876543210") === "+91 98••••••10", "masking");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
