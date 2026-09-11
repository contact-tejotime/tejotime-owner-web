-- =====================================================================
-- TejoTime — 0026_consent_log: a durable record of cookie-consent choices.
--
-- Under GDPR the burden of proof is on us: we must be able to show WHAT a visitor agreed to and
-- WHEN. The visitor's own `cookie_consent` cookie governs behaviour, but it lives in their
-- browser and they can clear it, so it cannot serve as evidence. This table is that evidence,
-- and nothing else reads from it.
--
-- WHAT IS DELIBERATELY NOT HERE, and why:
--
--   no ip address   Storing the IP would turn an audit row into a precise location record and a
--                   cross-site identifier — more personal data than the consent it documents.
--                   `country_code` is derived at the edge and kept instead: coarse enough to
--                   answer "was this visitor in the EU when they consented", useless for
--                   tracking anyone.
--   no user agent   Same reasoning; it is a strong fingerprinting signal and answers no question
--                   we actually have.
--   no business_id  These are anonymous site visitors, not tenant data — same as `inquiry`.
--
-- `visitor_id` is a random UUID the browser mints AT THE MOMENT OF CHOICE. It is not derived
-- from anything about the person, exists only because they chose, and is the only thing linking
-- a row to a browser.
--
-- Append-only by design: a visitor who changes their mind gets a NEW row, so the history of what
-- was agreed when survives. Nothing updates or deletes here.
-- =====================================================================

create table if not exists consent_log (
  id             uuid primary key default gen_random_uuid(),
  visitor_id     uuid not null,
  necessary      boolean not null default true,
  analytics      boolean not null,
  marketing      boolean not null,
  preferences    boolean not null,
  -- The CONSENT_VERSION in force when they chose (frontend/src/lib/consent.ts). Text, not a
  -- number: the value is a date string like '2026-09-11' and is only ever compared for equality.
  policy_version text not null,
  -- ISO 3166-1 alpha-2, from a CDN edge header. Null when no such header is present.
  country_code   char(2),
  created_at     timestamptz not null default now()
);

-- "What is this browser's consent history, newest first" — the only query this table serves.
create index if not exists idx_consent_log_visitor_created
  on consent_log (visitor_id, created_at desc);
