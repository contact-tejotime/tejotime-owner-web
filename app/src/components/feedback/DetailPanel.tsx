import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { initials } from '@/lib/format';
import { buildSeatGroups, flatCards } from '@/lib/queue';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

const EXTRAS = [
  { label: 'Shave', mins: 10 },
  { label: 'Beard trim', mins: 15 },
  { label: 'Hair wash', mins: 10 },
  { label: 'Hair color', mins: 30 },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors, radius, fontFamily, fontSize } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: colors.surfaceCard,
        borderWidth: 1,
        borderColor: colors.borderSubtle,
        borderRadius: radius.lg,
        paddingVertical: 14,
        paddingHorizontal: 16,
      }}>
      <Text style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.textMuted }}>{label}</Text>
      {children}
    </View>
  );
}

export function DetailPanel() {
  const { colors, radius, fontFamily, fontSize } = useTheme();
  const resolveColor = useServiceColor();
  const store = useAppState();
  const d = store.detail;
  const open = !!d;

  // Resolve the live entry + its computed card (pos / seat / source).
  const live = d ? store.queue.find((q) => q.id === d.id) ?? d : null;
  const cards = live ? flatCards(buildSeatGroups(store.queue, store.staff, store.services)) : [];
  const card = live ? cards.find((c) => c.id === live.id) : undefined;
  const seat = live ? store.staff.find((st) => st.id === live.staffId) : undefined;
  const seatColor = seat ? resolveColor(seat.color) : colors.textSubtle;
  const extra = live?.extra ?? 0;

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={store.closeDetail}>
      {live && (
        <View style={{ flex: 1, backgroundColor: colors.surfacePage }}>
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
              <Pressable onPress={store.closeDetail} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="chevronLeft" size={22} color={colors.textBody} />
              </Pressable>
              <Text style={{ fontFamily: fontFamily.bold, fontSize: fontSize.h5, color: colors.textStrong }}>Customer</Text>
            </View>

            <View style={{ flex: 1, paddingHorizontal: 20 }}>
              <View style={{ alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 18 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: fontFamily.bold, fontSize: 26, color: colors.primarySoftFg }}>{initials(live.name)}</Text>
                </View>
                <Text style={{ fontFamily: fontFamily.bold, fontSize: fontSize.h4, color: colors.textStrong }}>{live.name}</Text>
                <StatusBadge status={live.status} />
              </View>

              <View style={{ gap: 10 }}>
                <Row label="Seat">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: seatColor }} />
                    <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>{seat?.name ?? '—'}</Text>
                  </View>
                </Row>
                <Row label="Service">
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>{live.service}</Text>
                </Row>
                <Row label="Source">
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>
                    {live.src === 'online' ? 'Booked online' : 'Walk-in'}
                  </Text>
                </Row>
                <Row label="Position">
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>
                    #{card?.pos ?? '—'} in {seat?.name ?? 'this'}&apos;s line
                  </Text>
                </Row>
              </View>
            </View>

            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 14,
                paddingBottom: 8,
                borderTopWidth: 1,
                borderTopColor: colors.borderSubtle,
                backgroundColor: colors.surfaceCard,
                gap: 10,
              }}>
              {live.status === 'waiting' && (
                <>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: colors.textBody }}>
                    Move to another seat
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 2 }}>
                    {store.staff
                      .filter((st) => st.id !== live.staffId)
                      .map((st) => (
                        <Pressable
                          key={st.id}
                          onPress={() => store.reassign(live.id, st.id)}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 7,
                            paddingHorizontal: 13,
                            paddingVertical: 8,
                            borderRadius: radius.pill,
                            backgroundColor: colors.surfacePage,
                            borderWidth: 1,
                            borderColor: colors.borderDefault,
                          }}>
                          <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: resolveColor(st.color) }} />
                          <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: colors.textBody }}>{st.name}</Text>
                        </Pressable>
                      ))}
                  </View>
                  <Button variant="primary" size="lg" fullWidth onPress={() => store.startService(live.id)}>
                    Start service
                  </Button>
                  <Button variant="outline" fullWidth onPress={() => store.noShow(live.id)}>
                    Mark no-show
                  </Button>
                </>
              )}
              {live.status === 'in-service' && (
                <>
                  <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: colors.textBody }}>
                    Customer changed their mind? Add to this service
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {EXTRAS.map((e) => (
                      <Pressable
                        key={e.label}
                        onPress={() => store.extendService(live.id, e.label, e.mins)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: radius.pill,
                          backgroundColor: colors.surfacePage,
                          borderWidth: 1,
                          borderColor: colors.borderDefault,
                        }}>
                        <Icon name="plus" size={15} color={colors.textBody} />
                        <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: colors.textBody }}>
                          {e.label} · +{e.mins}m
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {extra > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.warningSoft, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9 }}>
                      <Icon name="clock" size={15} color={colors.warningSoftFg} />
                      <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: colors.warningSoftFg }}>
                        Service extended · +{extra} min added · queue updated
                      </Text>
                    </View>
                  )}
                  <Button variant="primary" size="lg" fullWidth onPress={() => store.checkout(live.id)}>
                    Complete &amp; start next
                  </Button>
                </>
              )}
            </View>
          </SafeAreaView>
        </View>
      )}
    </Modal>
  );
}
