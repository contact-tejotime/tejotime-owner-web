import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { business } from '@/data/sample';
import { useTheme } from '@/theme/ThemeProvider';

export function Header({
  title,
  subtitle,
  action,
  avatar = false,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  avatar?: boolean;
}) {
  const { colors, fontFamily, fontSize } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 16,
      }}>
      {avatar && <InitialsAvatar name={business.name} size={40} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: fontFamily.extrabold,
            fontSize: 22,
            color: colors.textStrong,
            letterSpacing: -0.4,
          }}>
          {title}
        </Text>
        {subtitle && (
          <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 3 }}>
            {subtitle}
          </Text>
        )}
      </View>
      {action}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  const { colors, fontFamily, fontSize } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 20,
        marginBottom: 12,
      }}>
      <Text style={{ fontFamily: fontFamily.bold, fontSize: fontSize.h5, color: colors.textStrong }}>
        {children}
      </Text>
      {action}
    </View>
  );
}

export function ScreenScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}
