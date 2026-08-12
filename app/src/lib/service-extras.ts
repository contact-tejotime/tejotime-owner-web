import type { IconName } from '@/components/ui/Icon';
import { t } from '@/i18n';

export type ServiceExtraChip = {
  /** Exact English label accepted by backend `extend`. */
  label: string;
  mins: number;
  icon: IconName;
};

type ExtraKind = 'default' | 'barber' | 'hospital' | 'restaurant';

function kindForCategory(category: string | null | undefined): ExtraKind {
  const c = category ?? '';
  if (/salon|barber|beauty|parlour|parlor|spa/i.test(c)) return 'barber';
  if (/hospital|clinic|dental|medical/i.test(c)) return 'hospital';
  if (/restaurant|cafe|café|food|dining/i.test(c)) return 'restaurant';
  return 'default';
}

const DEFAULT_EXTRAS: ServiceExtraChip[] = [
  { label: t.detail.extras.shave, mins: 10, icon: 'razor' },
  { label: t.detail.extras.beardTrim, mins: 15, icon: 'clipper' },
  { label: t.detail.extras.hairWash, mins: 10, icon: 'droplet' },
  { label: t.detail.extras.hairColor, mins: 30, icon: 'paintbrush' },
];

const BARBER_EXTRAS: ServiceExtraChip[] = [
  { label: t.detail.extras.shave, mins: 10, icon: 'straightRazor' },
  { label: t.detail.extras.beardTrim, mins: 15, icon: 'clippers' },
  { label: t.detail.extras.hairWash, mins: 10, icon: 'sprayBottle' },
  { label: t.detail.extras.hairColor, mins: 30, icon: 'comb' },
  { label: t.detail.extras.touchUpCut, mins: 15, icon: 'scissorsSolid' },
  { label: t.detail.extras.mustacheTrim, mins: 10, icon: 'mustache' },
  { label: t.detail.extras.blowDry, mins: 15, icon: 'hairDryer' },
  { label: t.detail.extras.headMassage, mins: 15, icon: 'barberChair' },
];

const HOSPITAL_EXTRAS: ServiceExtraChip[] = [
  { label: t.detail.extras.consultation, mins: 15, icon: 'stethoscope' },
  { label: t.detail.extras.injection, mins: 10, icon: 'injection' },
  { label: t.detail.extras.medication, mins: 5, icon: 'pill' },
  { label: t.detail.extras.checkUp, mins: 10, icon: 'thermometer' },
  { label: t.detail.extras.bloodTest, mins: 15, icon: 'bloodDrop' },
  { label: t.detail.extras.firstAid, mins: 10, icon: 'firstAid' },
  { label: t.detail.extras.assistedCare, mins: 20, icon: 'wheelchair' },
  { label: t.detail.extras.dental, mins: 20, icon: 'dentalTooth' },
];

const RESTAURANT_EXTRAS: ServiceExtraChip[] = [
  { label: t.detail.extras.dineIn, mins: 30, icon: 'forkKnife' },
  { label: t.detail.extras.burger, mins: 15, icon: 'burger' },
  { label: t.detail.extras.pizza, mins: 20, icon: 'pizza' },
  { label: t.detail.extras.coffee, mins: 10, icon: 'coffee' },
  { label: t.detail.extras.beverage, mins: 5, icon: 'beverage' },
  { label: t.detail.extras.dessert, mins: 10, icon: 'dessertCake' },
  { label: t.detail.extras.takeaway, mins: 10, icon: 'takeawayBox' },
  { label: t.detail.extras.chefSpecial, mins: 25, icon: 'chefHat' },
];

/** Checkout add-on chips gated by `business.category`. First keyword match wins. */
export function extrasForCategory(category: string | null | undefined): ServiceExtraChip[] {
  switch (kindForCategory(category)) {
    case 'barber':
      return BARBER_EXTRAS;
    case 'hospital':
      return HOSPITAL_EXTRAS;
    case 'restaurant':
      return RESTAURANT_EXTRAS;
    default:
      return DEFAULT_EXTRAS;
  }
}
