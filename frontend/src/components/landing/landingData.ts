import type { IconName } from "./Icon";

export const queueMock = [
  {
    token: "A-24",
    name: "Rahul M.",
    service: "Haircut + beard",
    status: "In service",
    statusFg: "var(--primary)",
    bg: "var(--primary-soft)",
    border: "var(--blue-200)",
    tokBg: "var(--primary)",
    tokFg: "#fff",
  },
  {
    token: "A-25",
    name: "Imran K.",
    service: "Haircut",
    status: "Waiting",
    statusFg: "var(--text-muted)",
    bg: "var(--surface-card)",
    border: "var(--border-subtle)",
    tokBg: "var(--surface-sunken)",
    tokFg: "var(--text-body)",
  },
  {
    token: "A-26",
    name: "Vikram S.",
    service: "Shave",
    status: "Waiting",
    statusFg: "var(--text-muted)",
    bg: "var(--surface-card)",
    border: "var(--border-subtle)",
    tokBg: "var(--surface-sunken)",
    tokFg: "var(--text-body)",
  },
];

export const marquee = [
  "Barber shops", "Salons", "Clinics", "Dentists", "Hospitals", "Service centers",
  "Consultants", "Car wash", "Spas", "Fitness studios", "Tutors", "Pet groomers",
  "Barber shops", "Salons", "Clinics", "Dentists", "Hospitals", "Service centers",
  "Consultants", "Car wash", "Spas", "Fitness studios", "Tutors", "Pet groomers",
];

export const features: {
  icon: IconName;
  title: string;
  desc: string;
  iconBg: string;
  iconFg: string;
}[] = [
  {
    icon: "building",
    title: "Professional business page",
    desc: "A beautiful page at tejotime.com/yourbusiness with services, pricing, photos and reviews. No coding.",
    iconBg: "var(--primary-soft)",
    iconFg: "var(--primary)",
  },
  {
    icon: "calendar",
    title: "Online appointments",
    desc: "Customers book 24/7. Pick a service, choose a time, confirm — it lands straight in your queue.",
    iconBg: "var(--secondary-soft)",
    iconFg: "var(--secondary)",
  },
  {
    icon: "ticket",
    title: "Live queue & tokens",
    desc: "Walk-ins and bookings in one line. Tokens, wait times and status update in real time.",
    iconBg: "var(--success-soft)",
    iconFg: "var(--success)",
  },
  {
    icon: "bell",
    title: "Automated reminders",
    desc: "Confirmations and reminders cut no-shows automatically — no manual WhatsApp or calls.",
    iconBg: "var(--warning-soft)",
    iconFg: "var(--warning)",
  },
  {
    icon: "users",
    title: "Customer management",
    desc: "Every customer, visit and history in one place. Know your regulars and bring them back.",
    iconBg: "var(--primary-soft)",
    iconFg: "var(--primary)",
  },
  {
    icon: "trendingUp",
    title: "Grow your business",
    desc: "Build presence, increase bookings and improve retention with technology that works for you.",
    iconBg: "var(--secondary-soft)",
    iconFg: "var(--secondary)",
  },
];

export const bookingBullets = [
  "Service → time → confirm in seconds",
  "Share via WhatsApp, Instagram or a QR code",
  "Fewer no-shows with auto reminders",
];

export const slots = [
  { t: "10:00", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)" },
  { t: "10:30", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)" },
  { t: "11:00", bg: "var(--primary)", border: "var(--primary)", fg: "#fff" },
  { t: "11:30", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)" },
  { t: "12:00", bg: "var(--surface-sunken)", border: "var(--border-subtle)", fg: "var(--text-subtle)" },
  { t: "12:30", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)" },
];

export const bookingDays = [
  { d: "Mon", n: "24", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)", subFg: "var(--text-muted)" },
  { d: "Tue", n: "25", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)", subFg: "var(--text-muted)" },
  { d: "Wed", n: "26", bg: "var(--primary)", border: "var(--primary)", fg: "#fff", subFg: "rgba(255,255,255,.8)" },
  { d: "Thu", n: "27", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)", subFg: "var(--text-muted)" },
  { d: "Fri", n: "28", bg: "var(--surface-card)", border: "var(--border-subtle)", fg: "var(--text-body)", subFg: "var(--text-muted)" },
];

export const ownerBullets = [
  "One live dashboard for the whole day",
  "Add walk-ins and start service in a tap",
  "Manage staff, services and working hours",
];

export const kpis: { icon: IconName; value: string; label: string; bg: string; fg: string }[] = [
  { icon: "users", value: "8", label: "In queue", bg: "var(--primary-soft)", fg: "var(--primary)" },
  { icon: "calendar", value: "24", label: "Today's bookings", bg: "var(--secondary-soft)", fg: "var(--secondary)" },
  { icon: "checkCircle", value: "17", label: "Completed", bg: "var(--success-soft)", fg: "var(--success)" },
  { icon: "dollar", value: "₹14.2k", label: "Revenue today", bg: "var(--warning-soft)", fg: "var(--warning)" },
];

export const stats = [
  { to: 1200, suffix: "+", label: "Businesses onboard" },
  { to: 480, suffix: "K+", label: "Appointments booked" },
  { to: 20, suffix: "+", label: "Industries served" },
  { to: 4.9, suffix: "", label: "Average owner rating" },
];

export const industries = [
  "Barber shops", "Beauty salons", "Nail studios", "Spas & wellness", "Doctors",
  "Dentists", "Clinics", "Hospitals", "Fitness trainers", "Yoga studios", "Tutors",
  "Driving schools", "Consultants", "Lawyers", "Photographers", "Pet groomers",
  "Car wash", "Service centers", "Tattoo artists", "And many more",
];

export const testimonials = [
  {
    quote: "Walk-ins used to be chaos. Now everyone gets a token and I can actually focus on cutting hair.",
    name: "Suresh",
    role: "Sharp Cuts · Barber",
    initials: "SC",
    avBg: "var(--blue-100)",
    avFg: "var(--blue-700)",
  },
  {
    quote: "My patients book online and get reminders. No-shows dropped and my front desk is calmer.",
    name: "Dr. Anjali",
    role: "Smile Care · Dental clinic",
    initials: "An",
    avBg: "var(--teal-100)",
    avFg: "var(--teal-700)",
  },
  {
    quote: "Setup took ten minutes and I didn't need a developer. It just works on my phone.",
    name: "Faisal",
    role: "AutoShine · Car wash",
    initials: "Fa",
    avBg: "var(--amber-100)",
    avFg: "var(--amber-700)",
  },
];

export const inquiryPerks = ["No setup fee", "Live in minutes", "Cancel anytime"];

export const footerCols = [
  { title: "Product", links: ["Features", "Booking page", "Owner app", "Pricing"] },
  { title: "Industries", links: ["Salons", "Clinics", "Fitness", "Consultants"] },
  { title: "Company", links: ["About", "Vision", "Careers", "Contact"] },
];
