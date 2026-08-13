import type { IconName } from "@/components/Icon";
import { t } from "@/i18n";

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
  { label: t.serviceExtras.shave, minutes: 10, icon: "razor" },
  { label: t.serviceExtras.beardTrim, minutes: 15, icon: "clipper" },
  { label: t.serviceExtras.hairWash, minutes: 10, icon: "droplet" },
  { label: t.serviceExtras.hairColor, minutes: 30, icon: "paintbrush" },
];

const BARBER_EXTRAS: ServiceExtraChip[] = [
  { label: t.serviceExtras.shave, minutes: 10, icon: "straightRazor" },
  { label: t.serviceExtras.beardTrim, minutes: 15, icon: "clippers" },
  { label: t.serviceExtras.hairWash, minutes: 10, icon: "sprayBottle" },
  { label: t.serviceExtras.hairColor, minutes: 30, icon: "comb" },
  { label: t.serviceExtras.touchUpCut, minutes: 15, icon: "scissorsSolid" },
  { label: t.serviceExtras.mustacheTrim, minutes: 10, icon: "mustache" },
  { label: t.serviceExtras.blowDry, minutes: 15, icon: "hairDryer" },
  { label: t.serviceExtras.headMassage, minutes: 15, icon: "barberChair" },
];

const HOSPITAL_EXTRAS: ServiceExtraChip[] = [
  { label: t.serviceExtras.consultation, minutes: 15, icon: "stethoscope" },
  { label: t.serviceExtras.injection, minutes: 10, icon: "injection" },
  { label: t.serviceExtras.medication, minutes: 5, icon: "pill" },
  { label: t.serviceExtras.checkUp, minutes: 10, icon: "thermometer" },
  { label: t.serviceExtras.bloodTest, minutes: 15, icon: "bloodDrop" },
  { label: t.serviceExtras.firstAid, minutes: 10, icon: "firstAid" },
  { label: t.serviceExtras.assistedCare, minutes: 20, icon: "wheelchair" },
  { label: t.serviceExtras.dental, minutes: 20, icon: "dentalTooth" },
];

const RESTAURANT_EXTRAS: ServiceExtraChip[] = [
  { label: t.serviceExtras.dineIn, minutes: 30, icon: "forkKnife" },
  { label: t.serviceExtras.burger, minutes: 15, icon: "burger" },
  { label: t.serviceExtras.pizza, minutes: 20, icon: "pizza" },
  { label: t.serviceExtras.coffee, minutes: 10, icon: "coffee" },
  { label: t.serviceExtras.beverage, minutes: 5, icon: "beverage" },
  { label: t.serviceExtras.dessert, minutes: 10, icon: "dessertCake" },
  { label: t.serviceExtras.takeaway, minutes: 10, icon: "takeawayBox" },
  { label: t.serviceExtras.chefSpecial, minutes: 25, icon: "chefHat" },
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
