import { redirect } from "next/navigation";

/** Old Queue tab — the live board now lives on Home. */
export default function QueuePage() {
  redirect("/dashboard");
}
