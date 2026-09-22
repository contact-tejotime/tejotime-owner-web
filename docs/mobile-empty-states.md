# Mobile empty states

**Added:** 2026-09-22 · **Applies to:** `app/`

Every "nothing here" message in the owner app goes through **`TEmptyState`**
(`app/src/components/common/TEmptyState.tsx`): an icon in a soft brand disc, the message, and an
optional hint, **centred**.

Empty messages used to be a line of muted text pinned to the top-left of wherever the list would
have been ("No customers yet" under the search bar, "No services yet" above an empty bordered
card). Owners read them as leftover text and asked for them in the middle.

## Two sizes

| Prop | Use for | Where |
|---|---|---|
| `fill` | A list that *is* the screen: the message fills the space left and centres in it | Customers, Appointments |
| `compact` | An empty *section* inside a screen or a sheet: centred in that section | Reports (staff, queue), calendar day sheet, country picker, profile gallery, Home's "no seats" board |
| neither | A page whose main list is empty but still has content under it | Settings → Services, Staff (the Add button sits right below) |

**`fill` only works if the parent can grow.** A `FlatList` needs `flexGrow: 1` on its
`contentContainerStyle` while empty (see `customers.tsx`). `TScreenScroll` takes `grow={isEmpty}`
for the same reason (see `appointments.tsx`). Without it, the empty state sits at the top.

## Wording

- Short, and no "yet" unless the next step is obvious from the screen: **"No customers"**, not "No
  customers yet".
- Put the explanation in `hint`, not the title: Appointments uses "No appointments today" + "Bookings
  for today show up here. Check Calendar for the rest of the week."
- A search with no results gets the `search` icon and its own text (`customers.noMatch`,
  `phone.noMatches`), so it doesn't look like the list is truly empty.

Form help text such as "no amenities added" or "no free chairs" is **not** an empty state, and
stays a caption beside its field.

## Not changed

owner-web's empty messages have their own wording and layout: for example, "No customers yet —
they appear after their first visit." on the web. They were not touched.
