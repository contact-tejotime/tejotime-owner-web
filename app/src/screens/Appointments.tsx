import React from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

import { Header, ScreenScroll } from './chrome';

export function Appointments() {
  const { colors, radius, fontFamily, fontSize, shadow } = useTheme();
  const store = useAppState();

  return (
    <>
      <Header
        title="Appointments"
        subtitle="Thursday, 24 June"
        action={
          <IconButton variant="soft" accessibilityLabel="Add" onPress={store.openWalkin}>
            <Icon name="plus" size={20} color={colors.textBody} />
          </IconButton>
        }
      />
      <ScreenScroll>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: fontSize.h5, color: colors.textStrong, marginTop: 10, marginBottom: 12 }}>
          Upcoming today
        </Text>
        <View style={{ gap: 10 }}>
          {store.appts.map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', gap: 14 }}>
              <Text
                style={{
                  width: 56,
                  paddingTop: 14,
                  textAlign: 'right',
                  fontFamily: fontFamily.semibold,
                  fontSize: fontSize.bodySm,
                  color: colors.textMuted,
                }}>
                {a.time}
              </Text>
              <View
                style={[
                  {
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    backgroundColor: colors.surfaceCard,
                    borderWidth: 1,
                    borderColor: colors.borderSubtle,
                    borderLeftWidth: 3,
                    borderLeftColor: colors.primary,
                    borderRadius: radius.md,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                  },
                  shadow.xs,
                ]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>
                    {a.name}
                  </Text>
                  <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.caption, color: colors.textMuted, marginTop: 3 }}>
                    {a.service}
                  </Text>
                </View>
                <Button variant="ghost" size="sm" onPress={() => store.checkInAppt(a)} textColor={colors.primary}>
                  Add to queue
                </Button>
              </View>
            </View>
          ))}
        </View>
      </ScreenScroll>
    </>
  );
}
