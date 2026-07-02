import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';

import { CustomerCard } from '@/components/cards/CustomerCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { useAppState } from '@/state/store';
import { useTheme } from '@/theme/ThemeProvider';

const FREE_LIMIT = 2;

export function Customers() {
  const { colors, dark, radius, fontFamily, fontSize, shadow } = useTheme();
  const store = useAppState();
  const isPremium = store.plan === 'premium';

  const q = store.search.toLowerCase();
  const matched = store.customers.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q),
  );
  const shown = isPremium ? matched : matched.slice(0, FREE_LIMIT);
  const lockedPreview = isPremium ? [] : matched.slice(FREE_LIMIT);
  const lockedCount = isPremium ? 0 : Math.max(0, store.customers.length - FREE_LIMIT);
  const subtitle = isPremium ? '312 total' : `Free trial · latest ${shown.length} shown`;

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fontFamily.extrabold, fontSize: 22, color: colors.textStrong, letterSpacing: -0.4 }}>
            Customers
          </Text>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 3 }}>
            {subtitle}
          </Text>
        </View>
        {isPremium && <Badge tone="primary">Premium</Badge>}
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
        <Input
          placeholder="Search by name or phone"
          leadingIcon={<Icon name="search" size={18} color={colors.textMuted} />}
          value={store.search}
          onChangeText={store.setSearch}
        />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}>
        <View style={{ gap: 12 }}>
          {shown.map((c) => (
            <CustomerCard
              key={c.id}
              name={c.name}
              phone={c.phone}
              tag={c.vip ? <Badge tone="primary">VIP</Badge> : null}
              meta={[
                { label: 'Visits', value: c.visits },
                { label: 'Last visit', value: c.last },
                { label: 'Spend', value: c.spend },
              ]}
            />
          ))}

          {lockedCount > 0 && (
            <View style={{ borderRadius: radius.lg, overflow: 'hidden', marginTop: 2 }}>
              <View style={{ gap: 12, opacity: 0.3 }} pointerEvents="none">
                {lockedPreview.map((c) => (
                  <CustomerCard
                    key={c.id}
                    name={c.name}
                    phone={c.phone}
                    meta={[
                      { label: 'Visits', value: c.visits },
                      { label: 'Last visit', value: c.last },
                      { label: 'Spend', value: c.spend },
                    ]}
                  />
                ))}
              </View>

              {Platform.OS === 'ios' && (
                <BlurView
                  intensity={40}
                  tint={dark ? 'dark' : 'light'}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                />
              )}
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: 20,
                  backgroundColor: dark ? 'rgba(11,18,32,0.55)' : 'rgba(248,250,252,0.5)',
                }}>
                <View
                  style={[
                    {
                      width: 48,
                      height: 48,
                      borderRadius: radius.lg,
                      backgroundColor: colors.warningSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    shadow.sm,
                  ]}>
                  <Icon name="star" size={22} color={colors.amber500} />
                </View>
                <Text style={{ fontFamily: fontFamily.bold, fontSize: fontSize.h5, color: colors.textStrong, textAlign: 'center' }}>
                  {lockedCount} more clients locked
                </Text>
                <Text
                  style={{
                    fontFamily: fontFamily.regular,
                    fontSize: fontSize.bodySm,
                    color: colors.textMuted,
                    textAlign: 'center',
                    maxWidth: 260,
                  }}>
                  Your free trial shows your latest clients. Upgrade to Premium to see your full customer history,
                  spend & visits.
                </Text>
                <View style={{ marginTop: 4 }}>
                  <Button
                    variant="primary"
                    onPress={store.upgrade}
                    leadingIcon={<Icon name="creditCard" size={20} color="#fff" />}>
                    Upgrade to Premium
                  </Button>
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}
