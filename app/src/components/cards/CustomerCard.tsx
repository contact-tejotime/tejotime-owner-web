import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { useTheme } from '@/theme/ThemeProvider';

type Meta = { label: string; value: string | number };

/** Customer / staff profile card with stats. */
export function CustomerCard({
  name,
  phone,
  meta = [],
  tag,
  onPress,
}: {
  name: string;
  phone?: string;
  meta?: Meta[];
  tag?: React.ReactNode;
  onPress?: () => void;
}) {
  const { colors, radius, space, fontFamily, fontSize, shadow } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          backgroundColor: colors.surfaceCard,
          borderWidth: 1,
          borderColor: colors.borderSubtle,
          borderRadius: radius.lg,
          padding: space[4],
        },
        shadow.xs,
      ]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <InitialsAvatar name={name} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>
            {name}
          </Text>
          {phone && (
            <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 }}>
              {phone}
            </Text>
          )}
        </View>
        {tag}
      </View>
      {meta.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            gap: space[5],
            marginTop: space[4],
            paddingTop: space[3],
            borderTopWidth: 1,
            borderTopColor: colors.borderSubtle,
          }}>
          {meta.map((m, i) => (
            <View key={i}>
              <Text style={{ fontFamily: fontFamily.bold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>
                {m.value}
              </Text>
              <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 3 }}>
                {m.label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}
