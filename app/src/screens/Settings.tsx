import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon, IconName } from '@/components/ui/Icon';
import { Switch } from '@/components/ui/Switch';
import { business } from '@/data/sample';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

import { Header, ScreenScroll } from './chrome';

const ROWS: { icon: IconName; label: string; action: 'qr' | 'toast' }[] = [
  { icon: 'building', label: 'Business profile', action: 'toast' },
  { icon: 'clock', label: 'Working hours', action: 'toast' },
  { icon: 'scissors', label: 'Services & pricing', action: 'toast' },
  { icon: 'users', label: 'Staff & permissions', action: 'toast' },
  { icon: 'qrCode', label: 'Booking QR code', action: 'qr' },
  { icon: 'creditCard', label: 'Subscription · Professional', action: 'toast' },
];

export function Settings() {
  const { colors, dark, setDark, radius, fontFamily, fontSize } = useTheme();
  const store = useAppState();

  return (
    <>
      <Header title="Settings" subtitle={business.name} avatar />
      <ScreenScroll>
        <View
          style={{
            backgroundColor: colors.surfaceCard,
            borderWidth: 1,
            borderColor: colors.borderSubtle,
            borderRadius: radius.lg,
            overflow: 'hidden',
            marginTop: 4,
          }}>
          {ROWS.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={r.action === 'qr' ? store.openQr : store.openAlerts}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingVertical: 15,
                paddingHorizontal: 16,
                borderBottomWidth: i < ROWS.length - 1 ? 1 : 0,
                borderBottomColor: colors.borderSubtle,
              }}>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceSunken,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Icon name={r.icon} size={18} color={colors.textBody} />
              </View>
              <Text style={{ flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.bodyMd, color: colors.textStrong }}>
                {r.label}
              </Text>
              <Icon name="chevronRight" size={18} color={colors.textSubtle} />
            </Pressable>
          ))}
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: colors.surfaceCard,
            borderWidth: 1,
            borderColor: colors.borderSubtle,
            borderRadius: radius.lg,
            paddingVertical: 14,
            paddingHorizontal: 16,
            marginTop: 14,
          }}>
          <Text style={{ fontFamily: fontFamily.medium, fontSize: fontSize.bodyMd, color: colors.textStrong }}>
            Dark mode
          </Text>
          <Switch checked={dark} onChange={setDark} />
        </View>
      </ScreenScroll>
    </>
  );
}
