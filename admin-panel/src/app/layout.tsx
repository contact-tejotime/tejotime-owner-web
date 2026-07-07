import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TejoTime Admin — Stores",
  description: "Create and manage stores and preview their live microsites.",
};

// The authenticated shell (sidebar + session gate) lives in app/(protected)/layout.tsx;
// /login renders bare. This root layout only sets up <html>/<body> + global styles.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
