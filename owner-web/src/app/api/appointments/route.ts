import { NextRequest } from "next/server";

import { forward } from "@/lib/proxy-route";
import { TAGS } from "@/lib/server-api";

/**
 * Book a customer — "Due to come back" → Book (docs/customer-due-list.md):
 * `{ customerId, serviceIds, slotStart, staffId? }`, where `slotStart` is a time
 * `/api/appointments/slots` offered. The API checks it like a customer's own booking (409 when it
 * was taken meanwhile). No SMS — the owner is on the phone with the customer.
 *
 * `customers` is revalidated too: a booked customer leaves the call list.
 */
export async function POST(req: NextRequest) {
  return forward(req, "/appointments", { tags: [TAGS.appointments, TAGS.dashboard, TAGS.customers] });
}
