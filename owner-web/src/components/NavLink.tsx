"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";

import { Spinner } from "@/components/Skeleton";

/**
 * A nav link that shows it was clicked.
 *
 * `loading.tsx` covers the destination, but there is a gap before it: Next only swaps in the
 * loading UI once the navigation actually starts, and on a slow connection the tap registers
 * nowhere for a moment. `useLinkStatus` reports pending from the click itself, so the item the
 * user pressed lights up straight away — which is the bit that stops them pressing it again.
 *
 * The indicator must live in a CHILD of <Link>. `useLinkStatus` reads the pending state of the
 * nearest Link above it, so calling it in the same component that renders the Link would always
 * read false.
 */
function PendingDot() {
  const { pending } = useLinkStatus();
  return pending ? <Spinner size={13} className="nav-spinner" /> : null;
}

export function NavLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={className}>
      {children}
      <PendingDot />
    </Link>
  );
}
