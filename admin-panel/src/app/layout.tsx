import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "TejoTime Admin",
  description: "Create and manage stores and preview their live microsites.",
};

// The authenticated shell (sidebar + session gate) lives in app/(protected)/layout.tsx;
// /login renders bare. This root layout only sets up <html>/<body> + global styles.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
