import React from 'react';
import { StyleProp, TextStyle } from 'react-native';

import { TText } from '@/components/common/TText';
import { formatAppointmentDate } from '@/lib/format';
import { fontFamily, SemanticColors, TextVariant } from '@/theme/tokens';

type WeightKey = keyof typeof fontFamily;

export function TFormattedDate({
  value,
  fallback = '—',
  variant = 'bodySm',
  color = 'textMuted',
  weight,
  style,
}: {
  value?: string | Date | null;
  fallback?: string;
  variant?: TextVariant;
  color?: keyof SemanticColors;
  weight?: WeightKey;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <TText variant={variant} color={color} weight={weight} style={style}>
      {formatAppointmentDate(value, fallback)}
    </TText>
  );
}
