import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/theme/ThemeProvider';

/** Service catalog card — name, duration, price, optional category color. */
export function ServiceCard({
  name,
  duration,
  price,
  description,
  color,
  selected = false,
  onPress,
}: {
  name: string;
  duration?: string;
  price?: string;
  description?: string;
  color?: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const { colors, radius, space, fontFamily, fontSize, shadow } = useTheme();
  const accent = color ?? colors.secondary;

  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[4],
          backgroundColor: colors.surfaceCard,
          borderWidth: 1.5,
          borderColor: selected ? colors.primary : colors.borderSubtle,
          borderRadius: radius.lg,
          padding: space[4],
        },
        selected ? shadow.sm : shadow.xs,
      ]}>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: radius.pill, backgroundColor: accent }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>
          {name}
        </Text>
        {description && (
          <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 }}>
            {description}
          </Text>
        )}
        {duration && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
            <Icon name="clock" size={14} color={colors.textMuted} />
            <Text style={{ fontFamily: fontFamily.medium, fontSize: fontSize.bodySm, color: colors.textMuted }}>
              {duration}
            </Text>
          </View>
        )}
      </View>
      {price != null && (
        <Text style={{ fontFamily: fontFamily.bold, fontSize: fontSize.h5, color: colors.textStrong }}>
          {price}
        </Text>
      )}
    </Pressable>
  );
}
