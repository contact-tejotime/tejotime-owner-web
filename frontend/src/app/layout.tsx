import type { Metadata, Viewport } from "next";
import { Inter, Yellowtail } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const yellowtail = Yellowtail({
  variable: "--font-script",
  subsets: ["latin"],
  weight: "400",
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
    <html lang="en" className={`${inter.variable} ${yellowtail.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
