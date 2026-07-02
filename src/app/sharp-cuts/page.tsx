"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/Button";
import "./salon.css";

type Service = { id: string; name: string; dur: string; price: number };
type Barber = {
  id: string;
  name: string;
  role: string;
  busy: boolean;
  count: number;
  wait: string;
  avBg: string;
};
type Ticket = { token: string; ahead: number; wait: number };

const SERVICES: Service[] = [
  { id: "cut", name: "Haircut", dur: "30 min", price: 250 },
  { id: "cutbeard", name: "Haircut + beard", dur: "45 min", price: 400 },
  { id: "beard", name: "Beard trim", dur: "15 min", price: 150 },
  { id: "color", name: "Hair color", dur: "60 min", price: 900 },
  { id: "massage", name: "Head massage", dur: "20 min", price: 200 },
  { id: "kids", name: "Kids haircut", dur: "25 min", price: 200 },
];

const BARBERS: Barber[] = [
  { id: "john", name: "John", role: "Master barber", busy: true, count: 3, wait: "~45m", avBg: "var(--primary)" },
  { id: "lisa", name: "Lisa", role: "Stylist · color", busy: true, count: 1, wait: "~15m", avBg: "var(--secondary)" },
  { id: "mike", name: "Mike", role: "Barber", busy: false, count: 0, wait: "Free", avBg: "var(--amber-500)" },
];

const FAQS = [
  { q: "Do I need an appointment?", a: "No — walk in any time and join the live queue, or book a slot ahead if you prefer a fixed time." },
  { q: "How does the live queue work?", a: "Join from your phone, get a token, and watch your position update live. We text you when you are two away." },
  { q: "Can I pick my barber?", a: "Yes. Choose any available barber, or pick a favourite when you join — you can see each barber’s current wait first." },
  { q: "What payments do you accept?", a: "UPI, all major cards, and cash. You pay at the shop after your service." },
];

const REVIEWS = [
  { stars: "★★★★★", text: "Best fade in Bandra, and I never wait. Joined the queue from home and walked in right on time.", name: "Aman R.", initial: "A", avBg: "var(--primary)" },
  { stars: "★★★★★", text: "Lisa nailed my colour. Loved seeing the live wait before heading over.", name: "Priya S.", initial: "P", avBg: "var(--secondary)" },
  { stars: "★★★★☆", text: "Clean, friendly, quick. The token tracking on my phone is genuinely useful.", name: "Rahul M.", initial: "R", avBg: "var(--amber-500)" },
];

const AMENITIES = ["Air conditioned", "UPI · Card · Cash", "Parking", "Free wifi", "Kids friendly", "Wheelchair access"];
const GALLERY = [1, 2, 3, 4];

const revealStyle: CSSProperties = { animation: "ttReveal .7s ease both" };
const eyebrow: CSSProperties = {
  font: "var(--fw-bold) 12px/1 var(--font-sans)",
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 16,
};

export default function SharpCutsPage() {
  const [navSolid, setNavSolid] = useState(false);
  const [liveWait, setLiveWait] = useState(35);
  const [liveCount, setLiveCount] = useState(6);

  const [joinOpen, setJoinOpen] = useState(false);
  const [mode, setMode] = useState<"queue" | "book">("queue");
  const [step, setStep] = useState(1);
  const [cart, setCart] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [barber, setBarber] = useState("any");
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [justTurn, setJustTurn] = useState(false);

  const joinOpenRef = useRef(joinOpen);
  joinOpenRef.current = joinOpen;
  const tktTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onScroll = () => {
      const solid = (window.scrollY || document.documentElement.scrollTop) > 30;
      setNavSolid((prev) => (prev !== solid ? solid : prev));
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const tick = setInterval(() => {
      if (joinOpenRef.current) return;
      setLiveWait((w) => {
        const next = Math.min(50, Math.max(15, w + (Math.random() < 0.5 ? -5 : 5)));
        setLiveCount(Math.max(3, Math.round(next / 6)));
        return next;
      });
    }, 6000);

    return () => {
      window.removeEventListener("scroll", onScroll);
      clearInterval(tick);
      if (tktTimer.current) clearInterval(tktTimer.current);
    };
  }, []);

  const openJoin = (m: "queue" | "book", preselectBarber = "any") => {
    setMode(m);
    setStep(1);
    setCart(null);
    setName("");
    setPhone("");
    setBarber(preselectBarber);
    setTicket(null);
    setJustTurn(false);
    setJoinOpen(true);
  };
  const openQueue = () => openJoin("queue");
  const openBook = () => openJoin("book");
  const openWith = (barberId: string) => openJoin("queue", barberId);
  const closeJoin = () => {
    setJoinOpen(false);
    if (tktTimer.current) clearInterval(tktTimer.current);
  };
  const toggleFaq = (i: number) => setFaqOpen((cur) => (cur === i ? null : i));

  const confirm = () => {
    if (!name.trim() || !phone.trim()) return;
    setStep(3);
    setTicket({ token: "A-24", ahead: 3, wait: 20 });
    setJustTurn(false);
    if (tktTimer.current) clearInterval(tktTimer.current);
    tktTimer.current = setInterval(() => {
      setTicket((t) => {
        if (!t) return t;
        const a = t.ahead - 1;
        if (a < 0) {
          if (tktTimer.current) clearInterval(tktTimer.current);
          setJustTurn(true);
          return t;
        }
        return { ...t, ahead: a, wait: Math.max(0, t.wait - 7) };
      });
    }, 4500);
  };

  const sel = SERVICES.find((x) => x.id === cart);
  const liveWaitLabel = `~${liveWait} min`;

  const navStyle: CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 100,
    transition: "background .25s ease, box-shadow .25s ease, border-color .25s ease",
    ...(navSolid
      ? {
          background: "color-mix(in srgb, var(--surface-card) 88%, transparent)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-xs)",
        }
      : { background: "transparent", borderBottom: "1px solid transparent" }),
  };

  const accent = (n: number) => {
    if (n === 1) return step >= 1 ? "var(--primary)" : "var(--border-default)";
    if (n === 2) return step >= 2 ? "var(--primary)" : "var(--surface-sunken)";
    return step >= 3 ? "var(--primary)" : "var(--surface-sunken)";
  };

  const t = ticket ?? ({} as Partial<Ticket>);
  const progressPct = justTurn
    ? "100%"
    : t.ahead != null
      ? `${Math.round((1 - t.ahead / 3) * 100)}%`
      : "0%";

  return (
    <div style={{ position: "relative", overflowX: "hidden" }}>
      {/* ===== NAV ===== */}
      <div style={navStyle}>
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "0 32px",
            height: 68,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 11,
                background: "linear-gradient(135deg, var(--brand-ink), var(--primary))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <Icon name="scissors" size={20} />
            </div>
            <span style={{ font: "var(--fw-extrabold) 21px/1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)" }}>
              Sharp Cuts
            </span>
          </div>
          <div style={{ display: "flex", gap: 26, alignItems: "center" }}>
            {[
              ["About", "#about"],
              ["Gallery", "#gallery"],
              ["Services", "#services"],
              ["Team", "#team"],
              ["Visit us", "#visit"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="salonNavLink"
                style={{ font: "var(--fw-medium) 14px/1 var(--font-sans)", color: "var(--text-muted)", textDecoration: "none", transition: "color .15s ease" }}
              >
                {label}
              </a>
            ))}
          </div>
          <Button onClick={openQueue}>Join queue</Button>
        </div>
      </div>

      {/* ===== HERO ===== */}
      <div style={{ position: "relative", height: 560, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--brand-ink) 22%, #cfd6e6), color-mix(in srgb, var(--primary) 18%, #dfe6f2) 60%, color-mix(in srgb, var(--secondary) 16%, #e3efed))",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: "6%",
            top: "50%",
            transform: "translateY(-50%)",
            width: 380,
            height: 380,
            borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,.5), transparent 62%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: "9%",
            bottom: 34,
            font: "var(--fw-medium) 12px/1 var(--font-sans)",
            color: "rgba(15,23,42,.4)",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <Icon name="building" size={15} />
          Hero photo — salon interior
        </div>
        <div
          style={{
            position: "relative",
            maxWidth: 1180,
            margin: "0 auto",
            height: "100%",
            padding: "0 32px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div style={{ maxWidth: 560, animation: "ttHero .7s ease both" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(255,255,255,.85)",
                border: "1px solid rgba(255,255,255,.7)",
                borderRadius: 999,
                padding: "6px 14px",
                backdropFilter: "blur(6px)",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)", display: "inline-block", animation: "ttPulse 1.8s ease-in-out infinite" }} />
              <span style={{ font: "var(--fw-semibold) 13px/1 var(--font-sans)", color: "var(--text-strong)" }}>Open now · till 8 PM</span>
            </div>
            <h1 style={{ font: "var(--fw-extrabold) 52px/1.03 var(--font-sans)", letterSpacing: "-.03em", color: "var(--brand-ink)", margin: "18px 0 10px" }}>
              Bandra&apos;s neighbourhood barber
            </h1>
            <p style={{ font: "var(--fw-medium) 17px/1.5 var(--font-sans)", color: "var(--text-body)", margin: "0 0 26px", maxWidth: 460 }}>
              ★ 4.9 (212 reviews) · Established 2014 · A proper cut, no long waits — track your turn from your phone.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  background: "var(--surface-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 14,
                  padding: "12px 18px",
                  boxShadow: "var(--shadow-md)",
                }}
              >
                <span style={{ display: "flex", color: "var(--secondary)" }}>
                  <Icon name="hourglass" size={22} />
                </span>
                <div>
                  <div style={{ font: "var(--fw-extrabold) 24px/1 var(--font-sans)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{liveWaitLabel} wait</div>
                  <div style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{liveCount} people in queue now</div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
              <Button size="lg" onClick={openQueue}>Join the queue →</Button>
              <Button size="lg" variant="outline" onClick={openBook}>Book a time slot</Button>
            </div>
          </div>
        </div>
      </div>

      {/* ===== TRUST BAR ===== */}
      <div style={{ background: "var(--surface-card)", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ ...revealStyle, maxWidth: 1180, margin: "0 auto", padding: "26px 32px", display: "flex", justifyContent: "space-around", textAlign: "center", gap: 20, flexWrap: "wrap" }}>
          {[
            ["10+ yrs", "in Bandra"],
            ["4 barbers", "expert team"],
            ["30k+", "haircuts done"],
            ["★ 4.9", "212 reviews"],
          ].map(([big, small]) => (
            <div key={small}>
              <div style={{ font: "var(--fw-extrabold) 26px/1 var(--font-sans)", color: "var(--primary)" }}>{big}</div>
              <div style={{ font: "var(--fw-medium) 12px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 6 }}>{small}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== ABOUT ===== */}
      <div id="about" style={{ maxWidth: 1180, margin: "0 auto", padding: "72px 32px 40px" }}>
        <div style={{ ...revealStyle, display: "flex", gap: 48, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--primary)", marginBottom: 12 }}>About the salon</div>
            <h2 style={{ font: "var(--fw-extrabold) 34px/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: "0 0 14px" }}>A proper cut, no long waits.</h2>
            <p style={{ font: "var(--fw-regular) 16px/1.6 var(--font-sans)", color: "var(--text-body)", margin: "0 0 24px" }}>
              Since 2014, Sharp Cuts has been Bandra&apos;s go-to for classic and modern cuts. Skilled barbers, clean chairs, and a live queue so you never waste time waiting around — step out, grab a chai, and we&apos;ll text you when you&apos;re close.
            </p>
            <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 11 }}>Amenities</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
              {AMENITIES.map((a) => (
                <span
                  key={a}
                  className="salonAmenity"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border-subtle)", borderRadius: 999, padding: "7px 14px", font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-body)", background: "var(--surface-card)" }}
                >
                  <span style={{ color: "var(--success)", display: "flex" }}>
                    <Icon name="check" size={14} />
                  </span>
                  {a}
                </span>
              ))}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 280,
              height: 260,
              borderRadius: 18,
              background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 12%, var(--surface-card)), color-mix(in srgb, var(--secondary) 12%, var(--surface-card)))",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-subtle)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 13px/1 var(--font-sans)" }}>
              <Icon name="building" size={18} />
              Photo — the space
            </span>
          </div>
        </div>
      </div>

      {/* ===== GALLERY ===== */}
      <div id="gallery" style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 32px 40px" }}>
        <div style={revealStyle}>
          <div style={eyebrow}>Gallery</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {GALLERY.map((g) => (
              <div
                key={g}
                className="salonGalleryCell"
                style={{ height: 150, borderRadius: 14, background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, var(--surface-card)), color-mix(in srgb, var(--secondary) 10%, var(--surface-card)))", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-subtle)", cursor: "pointer" }}
              >
                <Icon name="scissors" size={20} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== SERVICES ===== */}
      <div id="services" style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ ...revealStyle, maxWidth: 1180, margin: "0 auto", padding: "64px 32px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ font: "var(--fw-extrabold) 30px/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: 0 }}>What we offer</h2>
            <span style={{ font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-muted)" }}>Pricing shown when you join the queue or book</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 22 }}>
            {SERVICES.map((sv) => (
              <div
                key={sv.id}
                className="salonServiceCard"
                style={{ display: "flex", alignItems: "center", gap: 13, border: "1px solid var(--border-subtle)", borderRadius: 13, padding: 16, background: "var(--surface-page)" }}
              >
                <div style={{ width: 42, height: 42, borderRadius: 11, background: "color-mix(in srgb, var(--primary) 10%, var(--surface-card))", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)", flexShrink: 0 }}>
                  <Icon name="scissors" size={18} />
                </div>
                <span style={{ font: "var(--fw-semibold) 15px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>{sv.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== TEAM · LIVE AVAILABILITY ===== */}
      <div id="team" style={{ maxWidth: 1180, margin: "0 auto", padding: "64px 32px" }}>
        <div style={revealStyle}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ font: "var(--fw-extrabold) 30px/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: 0 }}>Our team · live availability</h2>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-muted)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success)", animation: "ttPulse 1.8s ease-in-out infinite" }} />
              Updated live · pick a barber when you join
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 24 }}>
            {BARBERS.map((b) => (
              <div
                key={b.id}
                className="salonBarberCard"
                style={{ border: "1px solid var(--border-subtle)", borderRadius: 16, padding: 20, background: "var(--surface-card)", boxShadow: "var(--shadow-xs)" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 16 }}>
                  <div style={{ width: 54, height: 54, borderRadius: "50%", background: b.avBg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: "var(--fw-bold) 19px/1 var(--font-sans)", flexShrink: 0 }}>{b.name[0]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "var(--fw-bold) 17px/1 var(--font-sans)", color: "var(--text-strong)" }}>{b.name}</div>
                    <div style={{ font: "var(--fw-regular) 13px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{b.role}</div>
                  </div>
                  <span
                    style={{
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      font: "var(--fw-semibold) 11px/1 var(--font-sans)",
                      padding: "5px 11px",
                      borderRadius: 999,
                      ...(b.busy
                        ? { background: "var(--surface-sunken)", color: "var(--text-body)" }
                        : { background: "var(--success-soft)", color: "var(--success-soft-fg)" }),
                    }}
                  >
                    {b.busy ? "Busy" : "Free now"}
                  </span>
                </div>
                <div style={{ display: "flex", border: "1px solid var(--border-subtle)", borderRadius: 11, overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ flex: 1, textAlign: "center", padding: "11px 4px", borderRight: "1px solid var(--border-subtle)" }}>
                    <div style={{ font: "var(--fw-extrabold) 22px/1 var(--font-sans)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{b.count}</div>
                    <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>in queue</div>
                  </div>
                  <div style={{ flex: 1.3, textAlign: "center", padding: "11px 4px" }}>
                    <div style={{ font: "var(--fw-extrabold) 22px/1 var(--font-sans)", color: b.busy ? "var(--text-strong)" : "var(--success)" }}>{b.wait}</div>
                    <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{b.busy ? "wait" : "walk in"}</div>
                  </div>
                </div>
                <Button variant="outline" fullWidth onClick={() => openWith(b.id)}>Join {b.name}&apos;s line</Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== REVIEWS ===== */}
      <div style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}>
        <div style={{ ...revealStyle, maxWidth: 1180, margin: "0 auto", padding: "64px 32px" }}>
          <h2 style={{ font: "var(--fw-extrabold) 30px/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "var(--text-strong)", margin: "0 0 24px" }}>What customers say · ★ 4.9</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {REVIEWS.map((r) => (
              <div
                key={r.name}
                className="salonReviewCard"
                style={{ border: "1px solid var(--border-subtle)", borderRadius: 16, padding: 22, background: "var(--surface-page)" }}
              >
                <div style={{ color: "var(--warning)", fontSize: 15, letterSpacing: 2, marginBottom: 12 }}>{r.stars}</div>
                <p style={{ font: "var(--fw-regular) 15px/1.6 var(--font-sans)", color: "var(--text-body)", margin: "0 0 18px" }}>{r.text}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: r.avBg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: "var(--fw-bold) 13px/1 var(--font-sans)" }}>{r.initial}</div>
                  <span style={{ font: "var(--fw-semibold) 13px/1 var(--font-sans)", color: "var(--text-muted)" }}>{r.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== FAQ ===== */}
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 32px 56px" }}>
        <div style={revealStyle}>
          <div style={eyebrow}>Good to know</div>
          <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 16, overflow: "hidden", background: "var(--surface-card)" }}>
            {FAQS.map((f, i) => {
              const open = faqOpen === i;
              return (
                <div key={f.q} style={{ borderBottom: i < FAQS.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                  <div onClick={() => toggleFaq(i)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", cursor: "pointer" }}>
                    <span style={{ font: "var(--fw-semibold) 16px/1.3 var(--font-sans)", color: "var(--text-strong)" }}>{f.q}</span>
                    <span style={{ display: "flex", color: "var(--text-muted)", transition: "transform .25s ease", transform: open ? "rotate(45deg)" : "rotate(0deg)" }}>
                      <Icon name="plus" size={18} />
                    </span>
                  </div>
                  <div style={{ overflow: "hidden", transition: "max-height .3s ease, opacity .3s ease", maxHeight: open ? 180 : 0, opacity: open ? 1 : 0 }}>
                    <div style={{ padding: "0 20px 18px", font: "var(--fw-regular) 15px/1.6 var(--font-sans)", color: "var(--text-muted)" }}>{f.a}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===== VISIT ===== */}
      <div id="visit" style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}>
        <div style={{ ...revealStyle, maxWidth: 1180, margin: "0 auto", padding: 0, display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300, padding: "56px 32px" }}>
            <div style={eyebrow}>Visit us</div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, font: "var(--fw-medium) 15px/1.4 var(--font-sans)", color: "var(--text-body)", marginBottom: 22 }}>
              <span style={{ color: "var(--primary)", display: "flex" }}>
                <Icon name="building" size={18} />
              </span>
              Shop 4, Linking Road, Bandra West, Mumbai
            </div>
            <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>Opening hours</div>
            <div style={{ maxWidth: 300 }}>
              {[
                ["Mon – Fri", "10 AM – 8 PM", "var(--text-strong)"],
                ["Saturday", "9 AM – 9 PM", "var(--text-strong)"],
                ["Sunday", "Closed", "var(--error)"],
              ].map(([day, hrs, col], i) => (
                <div
                  key={day}
                  style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: i < 2 ? "1px solid var(--border-subtle)" : "none", font: "var(--fw-medium) 14px/1 var(--font-sans)", color: "var(--text-body)" }}
                >
                  <span>{day}</span>
                  <span style={{ color: col }}>{hrs}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 300, minHeight: 280, background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 9%, var(--surface-page)), color-mix(in srgb, var(--secondary) 9%, var(--surface-page)))", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-subtle)", borderLeft: "1px solid var(--border-subtle)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 13px/1 var(--font-sans)" }}>
              <Icon name="building" size={18} />
              Map placeholder
            </span>
          </div>
        </div>
      </div>

      {/* ===== FINAL CTA ===== */}
      <div style={{ background: "linear-gradient(135deg, var(--brand-ink), var(--primary))", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -60, right: -30, width: 240, height: 240, borderRadius: "50%", background: "rgba(255,255,255,.08)", animation: "ttFloat 8s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: -70, left: "6%", width: 170, height: 170, borderRadius: "50%", background: "rgba(255,255,255,.06)", animation: "ttFloat 10s ease-in-out infinite" }} />
        <div style={{ position: "relative", maxWidth: 1180, margin: "0 auto", padding: "64px 32px", textAlign: "center" }}>
          <h2 style={{ font: "var(--fw-extrabold) 36px/1.1 var(--font-sans)", letterSpacing: "-.02em", color: "#fff", margin: "0 0 10px" }}>Skip the wait — join the live queue</h2>
          <p style={{ font: "var(--fw-medium) 16px/1.5 var(--font-sans)", color: "rgba(255,255,255,.85)", margin: "0 0 26px" }}>{liveCount} ahead of you · {liveWaitLabel} · we&apos;ll text you when you&apos;re close</p>
          <div
            onClick={openQueue}
            className="salonCtaBtn"
            style={{ display: "inline-block", cursor: "pointer", background: "#fff", color: "var(--primary)", font: "var(--fw-bold) 17px/1 var(--font-sans)", padding: "16px 32px", borderRadius: 12, boxShadow: "var(--shadow-lg)" }}
          >
            Join the queue →
          </div>
        </div>
      </div>

      {/* ===== FOOTER ===== */}
      <div style={{ background: "var(--surface-card)", borderTop: "1px solid var(--border-subtle)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--text-muted)" }}>
            Powered by{" "}
            <span style={{ font: "var(--fw-extrabold) 14px/1 var(--font-sans)" }}>
              <span style={{ color: "var(--brand-ink)" }}>Tejo</span>
              <span style={{ color: "var(--brand-accent)" }}>Time</span>
            </span>
          </span>
          <span style={{ font: "var(--fw-regular) 12px/1 var(--font-sans)", color: "var(--text-subtle)" }}>Terms · Privacy</span>
        </div>
      </div>

      {/* ===== JOIN / BOOK MODAL ===== */}
      {joinOpen && (
        <div
          onClick={closeJoin}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "ttFade .22s ease" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 460, maxWidth: "100%", background: "var(--surface-card)", borderRadius: 20, boxShadow: "var(--shadow-xl)", overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column", animation: "ttModalIn .42s cubic-bezier(.34,1.4,.5,1) both" }}
          >
            {/* header w/ steps */}
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ font: "var(--fw-extrabold) 20px/1 var(--font-sans)", color: "var(--text-strong)" }}>{mode === "book" ? "Book a time slot" : "Join the queue"}</span>
                <div onClick={closeJoin} style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--surface-page)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)" }}>
                  <Icon name="x" size={18} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 7, marginTop: 14 }}>
                <span style={{ height: 4, flex: 1, borderRadius: 999, background: accent(1) }} />
                <span style={{ height: 4, flex: 1, borderRadius: 999, background: accent(2) }} />
                <span style={{ height: 4, flex: 1, borderRadius: 999, background: accent(3) }} />
              </div>
            </div>

            <div style={{ padding: "22px 24px 26px", overflow: "auto" }}>
              {/* STEP 1: pick service */}
              {step === 1 && (
                <div style={{ animation: "ttStep .32s ease both" }}>
                  <p style={{ font: "var(--fw-regular) 14px/1.4 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 16px" }}>What are you here for today? Prices &amp; durations below.</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {SERVICES.map((sv) => {
                      const on = cart === sv.id;
                      return (
                        <div
                          key={sv.id}
                          onClick={() => setCart(sv.id)}
                          style={{
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 13,
                            borderRadius: 12,
                            padding: "13px 15px",
                            transition: "border-color .15s ease, background .15s ease",
                            background: on ? "color-mix(in srgb, var(--primary) 6%, var(--surface-card))" : "var(--surface-card)",
                            border: `1.5px solid ${on ? "var(--primary)" : "var(--border-subtle)"}`,
                          }}
                        >
                          <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? "var(--primary)" : "var(--border-default)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <span style={{ display: "flex", color: "var(--primary)", transition: "opacity .15s ease", opacity: on ? 1 : 0 }}>
                              <Icon name="check" size={13} />
                            </span>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ font: "var(--fw-semibold) 15px/1.2 var(--font-sans)", color: "var(--text-strong)" }}>{sv.name}</div>
                            <div style={{ font: "var(--fw-regular) 12px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>{sv.dur}</div>
                          </div>
                          <span style={{ font: "var(--fw-bold) 16px/1 var(--font-sans)", color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>₹{sv.price}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 20 }}>
                    <Button variant="primary" size="lg" fullWidth disabled={!cart} onClick={() => cart && setStep(2)}>
                      {cart ? `Continue · ${sel!.name} →` : "Pick a service to continue"}
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 2: details */}
              {step === 2 && (
                <div style={{ animation: "ttStep .32s ease both" }}>
                  <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Your name</div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Aman"
                    className="salonInput"
                    style={{ width: "100%", padding: "12px 14px", border: "1.5px solid var(--border-default)", borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--text-strong)", outline: "none", marginBottom: 16, background: "var(--surface-card)" }}
                  />
                  <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Phone number</div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="00000 00000"
                    className="salonInput"
                    style={{ width: "100%", padding: "12px 14px", border: "1.5px solid var(--border-default)", borderRadius: 10, fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--text-strong)", outline: "none", marginBottom: 16, background: "var(--surface-card)" }}
                  />
                  <div style={{ font: "var(--fw-bold) 12px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 9 }}>Preferred barber (optional)</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                    {[{ id: "any", name: "Any" }, ...BARBERS.map((b) => ({ id: b.id, name: b.name }))].map((c) => {
                      const on = barber === c.id;
                      return (
                        <span
                          key={c.id}
                          onClick={() => setBarber(c.id)}
                          style={{
                            cursor: "pointer",
                            font: "var(--fw-semibold) 13px/1 var(--font-sans)",
                            padding: "8px 15px",
                            borderRadius: 999,
                            transition: "all .15s ease",
                            ...(on
                              ? { background: "var(--primary)", color: "#fff", border: "1.5px solid var(--primary)" }
                              : { background: "var(--surface-card)", color: "var(--text-body)", border: "1.5px solid var(--border-subtle)" }),
                          }}
                        >
                          {c.name}
                        </span>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface-page)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: "13px 15px", marginBottom: 18 }}>
                    <span style={{ font: "var(--fw-medium) 13px/1.3 var(--font-sans)", color: "var(--text-body)" }}>
                      {(sel ? sel.name : "") + " · " + (mode === "book" ? "choose a time next" : `~${liveWait} min wait`)}
                    </span>
                    <span style={{ font: "var(--fw-bold) 16px/1 var(--font-sans)", color: "var(--text-strong)" }}>{sel ? `₹${sel.price}` : ""}</span>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Button variant="outline" size="lg" onClick={() => setStep(1)}>Back</Button>
                    <div style={{ flex: 1 }}>
                      <Button variant="primary" size="lg" fullWidth disabled={!name.trim() || !phone.trim()} onClick={confirm}>
                        {mode === "book" ? "Confirm booking →" : "Confirm · join queue →"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: ticket */}
              {step === 3 && (
                <div style={{ textAlign: "center", animation: "ttStep .32s ease both" }}>
                  <div style={{ position: "relative", width: 68, height: 68, margin: "6px auto 16px" }}>
                    <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid var(--success)", animation: "ttRing 1.2s ease-out infinite" }} />
                    <div style={{ position: "relative", width: 68, height: 68, borderRadius: "50%", background: "var(--success-soft)", color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", animation: "ttPop .5s cubic-bezier(.34,1.5,.5,1) both" }}>
                      <Icon name="check" size={34} />
                    </div>
                  </div>
                  <h3 style={{ font: "var(--fw-extrabold) 22px/1.2 var(--font-sans)", color: "var(--text-strong)", margin: "0 0 6px" }}>
                    {justTurn ? "It's your turn!" : mode === "book" ? "You're booked!" : "You're in the queue!"}
                  </h3>
                  <p style={{ font: "var(--fw-regular) 13px/1.4 var(--font-sans)", color: "var(--text-muted)", margin: "0 0 18px" }}>
                    {justTurn ? "Head to the chair — see you inside." : "We'll text you when you're 2 away."}
                  </p>
                  <div style={{ border: "2px solid var(--text-strong)", borderRadius: 16, padding: 20, marginBottom: 16 }}>
                    <div style={{ font: "var(--fw-bold) 11px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Your token</div>
                    <div style={{ font: "var(--fw-extrabold) 46px/1 var(--font-sans)", color: "var(--text-strong)", margin: "8px 0", letterSpacing: "-.01em" }}>{t.token ?? "A-24"}</div>
                    <div style={{ display: "flex", justifyContent: "space-around", marginTop: 10 }}>
                      <div>
                        <div style={{ font: "var(--fw-extrabold) 26px/1 var(--font-sans)", color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{justTurn ? 0 : t.ahead ?? 3}</div>
                        <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>ahead of you</div>
                      </div>
                      <div>
                        <div style={{ font: "var(--fw-extrabold) 26px/1 var(--font-sans)", color: "var(--secondary)", fontVariantNumeric: "tabular-nums" }}>{justTurn ? "Now" : `~${t.wait ?? 20}m`}</div>
                        <div style={{ font: "var(--fw-medium) 11px/1 var(--font-sans)", color: "var(--text-muted)", marginTop: 5 }}>est. wait</div>
                      </div>
                    </div>
                    <div style={{ height: 6, background: "var(--surface-sunken)", borderRadius: 999, marginTop: 16, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: progressPct, background: "var(--success)", borderRadius: 999, transition: "width .6s ease" }} />
                    </div>
                  </div>
                  <Button variant="primary" fullWidth onClick={closeJoin}>Done</Button>
                  <div onClick={closeJoin} style={{ font: "var(--fw-medium) 13px/1 var(--font-sans)", color: "var(--error)", marginTop: 14, cursor: "pointer" }}>Leave queue</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
