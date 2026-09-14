import type { Metadata, Viewport } from "next";
import { t } from "@/i18n";
import { Inter } from "next/font/google";
import OwnerHelpChat from "@/components/chat/OwnerHelpChat";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: t.meta.title,
  description: t.meta.description,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8fafc",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body suppressHydrationWarning>
        {children}
        {/* Product help bot — gated by CHATBOT_ENABLED via /api/chat/status; works on /login too. */}
        <OwnerHelpChat />
      </body>
    </html>
  );
}
