import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ServiceCard } from '@/components/cards/ServiceCard';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

function SegButton({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors, radius, fontFamily, fontSize, shadow } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        { flex: 1, alignItems: 'center', borderRadius: radius.md, paddingVertical: 10 },
        on ? { backgroundColor: colors.surfaceCard, ...shadow.xs } : null,
      ]}>
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: on ? colors.primary : colors.textMuted }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AddWalkInSheet() {
  const { colors, radius, fontFamily, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const resolveColor = useServiceColor();
  const store = useAppState();
  const open = store.sheet === 'walkin';

  const seatById = Object.fromEntries(store.seats.map((g) => [g.id, g]));
  let autoSeat = store.staff[0]?.id ?? '';
  let bestLoad = Infinity;
  store.staff.forEach((st) => {
    const load = seatById[st.id]?.clearMinutes ?? 0;
    if (load < bestLoad) {
      bestLoad = load;
      autoSeat = st.id;
    }
  });
  const autoName = store.staff.find((st) => st.id === autoSeat)?.name ?? '';

  const staffOptions = [
    { id: 'auto', name: 'Any seat', initial: '✦', sub: `Soonest free · ${autoName}`, color: colors.textSubtle },
    ...store.staff.map((st) => {
      const g = seatById[st.id];
      const w = g?.waitN ?? 0;
      const load = g?.clearMinutes ?? 0;
      return {
        id: st.id,
        name: st.name,
        initial: st.name[0],
        sub: w === 0 ? 'Free now' : `${w} waiting · ~${load}m`,
        color: resolveColor(st.color),
      };
    }),
  ];

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={store.closeWalkin}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={store.closeWalkin} style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)' }} />
        <View
          style={{
            backgroundColor: colors.surfaceCard,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 26 + insets.bottom,
            maxHeight: '86%',
          }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: colors.borderDefault, alignSelf: 'center', marginBottom: 16 }} />
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.h4, color: colors.textStrong, marginBottom: 16 }}>
            Add walk-in
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Input
              label="Customer name"
              placeholder="Full name"
              value={store.walkin.name}
              onChangeText={store.setWalkinField('name')}
              containerStyle={{ marginBottom: 14 }}
            />
            <Input
              label="Phone"
              prefix="+91"
              placeholder="98xxx xxxxx"
              keyboardType="phone-pad"
              value={store.walkin.phone}
              onChangeText={store.setWalkinField('phone')}
            />

            <Text style={{ fontFamily: fontFamily.medium, fontSize: fontSize.bodySm, color: colors.textBody, marginTop: 18, marginBottom: 8 }}>
              Service
            </Text>
            <View style={{ gap: 8 }}>
              {store.services.map((sv) => (
                <ServiceCard
                  key={sv.name}
                  name={sv.name}
                  duration={sv.duration}
                  price={sv.price}
                  color={resolveColor(sv.color)}
                  selected={store.walkin.service === sv.name}
                  onPress={() => store.pickService(sv.name)}
                />
              ))}
            </View>
            {!!store.walkin.error && (
              <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.error, marginTop: 10 }}>
                {store.walkin.error}
              </Text>
            )}

            <Text style={{ fontFamily: fontFamily.medium, fontSize: fontSize.bodySm, color: colors.textBody, marginTop: 18, marginBottom: 8 }}>
              Assign to seat
            </Text>
            <View style={{ gap: 8 }}>
              {staffOptions.map((o) => {
                const sel = store.walkin.staffId === o.id;
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => store.setWalkinStaff(o.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 11,
                      borderRadius: radius.lg,
                      paddingHorizontal: 13,
                      paddingVertical: 11,
                      backgroundColor: colors.surfaceCard,
                      borderWidth: 1.5,
                      borderColor: sel ? colors.primary : colors.borderSubtle,
                    }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: o.color, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: fontFamily.bold, fontSize: 13, color: '#fff' }}>{o.initial}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>{o.name}</Text>
                      <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.caption, color: colors.textMuted, marginTop: 3 }}>{o.sub}</Text>
                    </View>
                    {sel && <Icon name="check" size={18} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </View>

            <Text style={{ fontFamily: fontFamily.medium, fontSize: fontSize.bodySm, color: colors.textBody, marginTop: 18, marginBottom: 8 }}>
              Add to queue as
            </Text>
            <View style={{ flexDirection: 'row', gap: 4, backgroundColor: colors.surfaceSunken, borderRadius: radius.lg, padding: 4 }}>
              <SegButton label="End of queue" on={store.walkin.position === 'end'} onPress={() => store.setWalkinPosition('end')} />
              <SegButton label="Next up" on={store.walkin.position === 'next'} onPress={() => store.setWalkinPosition('next')} />
            </View>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.caption, color: colors.textSubtle, marginTop: 8 }}>
              Next up places them right after the customer in service.
            </Text>
          </ScrollView>

          <View style={{ marginTop: 16 }}>
            <Button variant="primary" size="lg" fullWidth onPress={store.addWalkin}>
              Add to queue
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
