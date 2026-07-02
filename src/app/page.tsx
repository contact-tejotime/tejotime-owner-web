const features = [
  {
    title: "Online booking",
    body: "Let customers book appointments 24/7 from any device — no calls, no back-and-forth.",
  },
  {
    title: "Live queue",
    body: "Show real-time wait times and keep walk-ins moving with a queue everyone can see.",
  },
  {
    title: "Reminders",
    body: "Automatic SMS and email reminders that cut no-shows and keep your day on track.",
  },
  {
    title: "Customer management",
    body: "Every customer, visit and note in one place — build relationships that come back.",
  },
];

export default function Home() {
  return (
    <main
      style={{
        maxWidth: "var(--container-max)",
        margin: "0 auto",
        padding: "96px 24px",
      }}
    >
      <section style={{ textAlign: "center", marginBottom: 72 }}>
        <p
          style={{
            fontFamily: "var(--font-script)",
            fontSize: 28,
            color: "var(--secondary)",
            margin: 0,
          }}
        >
          TejoTime
        </p>
        <h1
          style={{
            fontSize: 48,
            lineHeight: 1.1,
            fontWeight: 800,
            color: "var(--text-strong)",
            margin: "12px auto 20px",
            maxWidth: 780,
          }}
        >
          Run your queue, bookings &{" "}
          <span className="tt-grad-text">customers</span> in one place
        </h1>
        <p
          style={{
            fontSize: 18,
            color: "var(--text-muted)",
            maxWidth: 620,
            margin: "0 auto 32px",
          }}
        >
          The digital OS for small business. Online booking, a live queue,
          reminders and customer management — without a developer or IT team.
        </p>
        <a
          href="#features"
          style={{
            display: "inline-block",
            background: "var(--primary)",
            color: "var(--text-on-brand)",
            padding: "14px 28px",
            borderRadius: "var(--radius-pill)",
            fontWeight: 600,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          Get started
        </a>
      </section>

      <section
        id="features"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 20,
        }}
      >
        {features.map((f) => (
          <article
            key={f.title}
            style={{
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-lg)",
              padding: 28,
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "var(--text-strong)",
                margin: "0 0 8px",
              }}
            >
              {f.title}
            </h2>
            <p style={{ margin: 0, color: "var(--text-body)", lineHeight: 1.5 }}>
              {f.body}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
