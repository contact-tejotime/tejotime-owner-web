import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { listBusinesses } from "@/lib/server-api";

export const metadata: Metadata = {
  title: "TejoTime Admin — Stores",
  description: "Create and manage stores and preview their live microsites.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const stores = await listBusinesses();
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <div className="app">
          <Sidebar stores={stores} />
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
