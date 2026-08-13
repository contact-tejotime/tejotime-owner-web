import { t } from "@/i18n";

import type { IconName } from "./Icon";

/**
 * Presentation data for the landing page: which icon, which colour token, which slot.
 * Every user-facing word comes from `t.landingData` — this file only decides how it looks.
 */

export const queueMock = [
  {
    token: "A-24",
    name: t.landingData.queueMock[0].name,
    service: t.landingData.queueMock[0].service,
    status: t.landingData.queueMock[0].status,
    statusFg: "var(--primary)",
    bg: "var(--primary-soft)",
    border: "var(--blue-200)",
    tokBg: "var(--primary)",
    tokFg: "#fff",
  },
  {
    token: "A-25",
    name: t.landingData.queueMock[1].name,
    service: t.landingData.queueMock[1].service,
    status: t.landingData.queueMock[1].status,
    statusFg: "var(--text-muted)",
    bg: "var(--surface-card)",
    border: "var(--border-subtle)",
    tokBg: "var(--surface-sunken)",
    tokFg: "var(--text-body)",
  },
  {
    token: "A-26",
    name: t.landingData.queueMock[2].name,
    service: t.landingData.queueMock[2].service,
    status: t.landingData.queueMock[2].status,
    statusFg: "var(--text-muted)",
    bg: "var(--surface-card)",
    border: "var(--border-subtle)",
    tokBg: "var(--surface-sunken)",
    tokFg: "var(--text-body)",
  },
];

// The strip scrolls seamlessly, so the list is rendered twice.
export const marquee = [...t.landingData.marquee, ...t.landingData.marquee];

export const features: {
  icon: IconName;
  title: string;
  desc: string;
  iconBg: string;
  iconFg: string;
}[] = [
  {
    icon: "building",
    title: t.landingData.features.businessPage.title,
    desc: t.landingData.features.businessPage.desc,
    iconBg: "var(--primary-soft)",
    iconFg: "var(--primary)",
  },
  {
    icon: "calendar",
    title: t.landingData.features.appointments.title,
    desc: t.landingData.features.appointments.desc,
    iconBg: "var(--secondary-soft)",
    iconFg: "var(--secondary)",
  },
  {
    icon: "ticket",
    title: t.landingData.features.queue.title,
    desc: t.landingData.features.queue.desc,
    iconBg: "var(--success-soft)",
    iconFg: "var(--success)",
  },
  {
    icon: "bell",
    title: t.landingData.features.reminders.title,
    desc: t.landingData.features.reminders.desc,
    iconBg: "var(--warning-soft)",
    iconFg: "var(--warning)",
  },
  {
    icon: "users",
    title: t.landingData.features.customers.title,
    desc: t.landingData.features.customers.desc,
    iconBg: "var(--primary-soft)",
    iconFg: "var(--primary)",
  },
  {
    icon: "trendingUp",
    title: t.landingData.features.grow.title,
    desc: t.landingData.features.grow.desc,
    iconBg: "var(--secondary-soft)",
    iconFg: "var(--secondary)",
  },
];

export const bookingBullets = t.landingData.bookingBullets;

export const slots = [
  { t: "10:00", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)" },
  { t: "10:30", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)" },
  { t: "11:00", bg: "var(--primary)", border: "var(--primary)", fg: "#fff" },
  { t: "11:30", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)" },
  { t: "12:00", bg: "var(--surface-sunken)", border: "var(--border-subtle)", fg: "var(--text-subtle)" },
  { t: "12:30", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)" },
];

export const bookingDays = [
  { d: t.landingData.bookingDays[0], n: "24", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)", subFg: "var(--text-muted)" },
  { d: t.landingData.bookingDays[1], n: "25", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)", subFg: "var(--text-muted)" },
  { d: t.landingData.bookingDays[2], n: "26", bg: "var(--primary)", border: "var(--primary)", fg: "#fff", subFg: "rgba(255,255,255,.8)" },
  { d: t.landingData.bookingDays[3], n: "27", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)", subFg: "var(--text-muted)" },
  { d: t.landingData.bookingDays[4], n: "28", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)", subFg: "var(--text-muted)" },
];

export const ownerBullets = t.landingData.ownerBullets;

export const kpis: { icon: IconName; value: string; label: string; bg: string; fg: string }[] = [
  { icon: "users", value: "8", label: t.landingData.kpis.inQueue, bg: "var(--primary-soft)", fg: "var(--primary)" },
  { icon: "calendar", value: "24", label: t.landingData.kpis.todaysBookings, bg: "var(--secondary-soft)", fg: "var(--secondary)" },
  { icon: "checkCircle", value: "17", label: t.landingData.kpis.completed, bg: "var(--success-soft)", fg: "var(--success)" },
  { icon: "dollar", value: "₹14.2k", label: t.landingData.kpis.revenueToday, bg: "var(--warning-soft)", fg: "var(--warning)" },
];

export const stats = [
  { to: 1200, suffix: "+", label: t.landingData.stats.businesses },
  { to: 480, suffix: "K+", label: t.landingData.stats.appointments },
  { to: 20, suffix: "+", label: t.landingData.stats.industries },
  { to: 4.9, suffix: "", label: t.landingData.stats.rating },
];

export const industries = t.landingData.industries;

export const testimonials = [
  {
    quote: t.landingData.testimonials[0].quote,
    name: t.landingData.testimonials[0].name,
    role: t.landingData.testimonials[0].role,
    initials: "SC",
    avBg: "var(--blue-100)",
    avFg: "var(--blue-700)",
  },
  {
    quote: t.landingData.testimonials[1].quote,
    name: t.landingData.testimonials[1].name,
    role: t.landingData.testimonials[1].role,
    initials: "An",
    avBg: "var(--teal-100)",
    avFg: "var(--teal-700)",
  },
  {
    quote: t.landingData.testimonials[2].quote,
    name: t.landingData.testimonials[2].name,
    role: t.landingData.testimonials[2].role,
    initials: "Fa",
    avBg: "var(--amber-100)",
    avFg: "var(--amber-700)",
  },
];

export const inquiryPerks = t.landingData.inquiryPerks;

export const footerCols = t.landingData.footerCols;
