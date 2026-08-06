import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display, Plus_Jakarta_Sans, Yellowtail } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Plus Jakarta Sans is the face the owner mobile app already ships, so using it here puts the
// microsite, the app and the store's own branding in one voice. It also has more character than
// Inter at display sizes, which is what the section headings needed.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const yellowtail = Yellowtail({
  variable: "--font-script",
  subsets: ["latin"],
  weight: "400",
});

// Display serif for the `luxury` preset of the microsite theme engine (theme/engine/typography.ts
// puts it at the head of that preset's `--font-display` stack). Self-hosted by next/font at build
// time like the other two — no runtime network request.
//
// preload: false is deliberate. Only one of six presets paints with this face, so preloading it
// would add a render-blocking font request to the marketing page and to every non-luxury
// microsite for glyphs they never draw. Without the preload the browser fetches it lazily, i.e.
// only on the pages that actually use it.
const playfairDisplay = Playfair_Display({
  variable: "--font-display-serif",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  preload: false,
});

export const metadata: Metadata = {
  title: "TejoTime — Run your queue, bookings & customers in one place",
  description:
    "The digital OS for small business. TejoTime gives any appointment-based business online booking, a live queue, reminders and customer management — without a developer or IT team.",
};

// Explicit mobile viewport (Next injects a default, but pin it here so scaling is
// controlled). user-scalable stays on for accessibility — no maximum-scale lock.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jakarta.variable} ${yellowtail.variable} ${playfairDisplay.variable}`}
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
