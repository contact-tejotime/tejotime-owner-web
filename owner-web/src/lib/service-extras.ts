import type { IconName } from "@/components/Icon";

export type ServiceExtraChip = {
  label: string;
  minutes: number;
  icon: IconName;
};

type ExtraKind = "default" | "barber" | "hospital" | "restaurant";

function kindForCategory(category: string | null | undefined): ExtraKind {
  const c = category ?? "";
  if (/salon|barber|beauty|parlour|parlor|spa/i.test(c)) return "barber";
  if (/hospital|clinic|dental|medical/i.test(c)) return "hospital";
  if (/restaurant|cafe|café|food|dining/i.test(c)) return "restaurant";
  return "default";
}

const DEFAULT_EXTRAS: ServiceExtraChip[] = [
  { label: "Shave", minutes: 10, icon: "razor" },
  { label: "Beard trim", minutes: 15, icon: "clipper" },
  { label: "Hair wash", minutes: 10, icon: "droplet" },
  { label: "Hair color", minutes: 30, icon: "paintbrush" },
];

const BARBER_EXTRAS: ServiceExtraChip[] = [
  { label: "Shave", minutes: 10, icon: "straightRazor" },
  { label: "Beard trim", minutes: 15, icon: "clippers" },
  { label: "Hair wash", minutes: 10, icon: "sprayBottle" },
  { label: "Hair color", minutes: 30, icon: "comb" },
  { label: "Touch-up cut", minutes: 15, icon: "scissorsSolid" },
  { label: "Mustache trim", minutes: 10, icon: "mustache" },
  { label: "Blow-dry", minutes: 15, icon: "hairDryer" },
  { label: "Head massage", minutes: 15, icon: "barberChair" },
];

const HOSPITAL_EXTRAS: ServiceExtraChip[] = [
  { label: "Consultation", minutes: 15, icon: "stethoscope" },
  { label: "Injection", minutes: 10, icon: "injection" },
  { label: "Medication", minutes: 5, icon: "pill" },
  { label: "Check-up", minutes: 10, icon: "thermometer" },
  { label: "Blood test", minutes: 15, icon: "bloodDrop" },
  { label: "First aid", minutes: 10, icon: "firstAid" },
  { label: "Assisted care", minutes: 20, icon: "wheelchair" },
  { label: "Dental", minutes: 20, icon: "dentalTooth" },
];

const RESTAURANT_EXTRAS: ServiceExtraChip[] = [
  { label: "Dine-in", minutes: 30, icon: "forkKnife" },
  { label: "Burger", minutes: 15, icon: "burger" },
  { label: "Pizza", minutes: 20, icon: "pizza" },
  { label: "Coffee", minutes: 10, icon: "coffee" },
  { label: "Beverage", minutes: 5, icon: "beverage" },
  { label: "Dessert", minutes: 10, icon: "dessertCake" },
  { label: "Takeaway", minutes: 10, icon: "takeawayBox" },
  { label: "Chef special", minutes: 25, icon: "chefHat" },
];

/** Checkout add-on chips gated by `business.category`. First keyword match wins. */
export function extrasForCategory(category: string | null | undefined): ServiceExtraChip[] {
  switch (kindForCategory(category)) {
    case "barber":
      return BARBER_EXTRAS;
    case "hospital":
      return HOSPITAL_EXTRAS;
    case "restaurant":
      return RESTAURANT_EXTRAS;
    default:
      return DEFAULT_EXTRAS;
  }
}
