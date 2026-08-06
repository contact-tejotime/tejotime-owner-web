/**
 * Preset registry.
 *
 * `PRESETS` is the single lookup the rest of the engine uses; `PRESET_LIST` is the ordered
 * version for admin UI (registry key order is not a stable contract, declaration order is).
 */

import type { PresetDefinition, PresetId } from '../types';
import { bold } from './bold';
import { luxury } from './luxury';
import { medical } from './medical';
import { minimal } from './minimal';
import { modern } from './modern';
import { warm } from './warm';

export { bold, luxury, medical, minimal, modern, warm };

export const PRESETS: Record<PresetId, PresetDefinition> = {
  minimal,
  luxury,
  modern,
  bold,
  medical,
  warm,
};

/** Order shown in the admin preset picker: safest first, most opinionated last. */
export const PRESET_LIST: PresetDefinition[] = [minimal, modern, luxury, warm, medical, bold];

export function getPreset(id: PresetId): PresetDefinition {
  return PRESETS[id];
}
