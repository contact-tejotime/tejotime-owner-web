import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export type TabItem = { id: string; label: string; badge?: number };

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: TabItem[];
  value: string;
  onChange?: (id: string) => void;
}) {
  const { colors, radius, fontFamily } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 20,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSubtle,
      }}>
      {items.map((it) => {
        const active = it.id === value;
        return (
          <Pressable
            key={it.id}
            onPress={() => onChange?.(it.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingBottom: 12,
              borderBottomWidth: 2,
              marginBottom: -1,
              borderBottomColor: active ? colors.primary : 'transparent',
            }}>
            <Text
              style={{
                fontFamily: fontFamily.semibold,
                fontSize: 15,
                color: active ? colors.textStrong : colors.textMuted,
              }}>
              {it.label}
            </Text>
            {it.badge != null && (
              <View
                style={{
                  backgroundColor: active ? colors.primarySoft : colors.surfaceSunken,
                  borderRadius: radius.pill,
                  paddingHorizontal: 7,
                  paddingVertical: 3,
                }}>
                <Text
                  style={{
                    fontFamily: fontFamily.semibold,
                    fontSize: 11,
                    color: active ? colors.primarySoftFg : colors.textMuted,
                  }}>
                  {it.badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
