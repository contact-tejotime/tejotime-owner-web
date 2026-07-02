import React, { useRef } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, ScrollView, Text, View } from 'react-native';

import { QueueCard } from '@/components/cards/QueueCard';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { CardVM, buildSeatGroups, SeatGroupVM } from '@/lib/queue';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

import { Header } from './chrome';

/** Waiting card that long-press-drags to reorder within its seat. */
function DraggableCard({
  card,
  index,
  count,
  onOpen,
  scrollAt,
}: {
  card: CardVM;
  index: number;
  count: number;
  onOpen: () => void;
  scrollAt: React.MutableRefObject<number>;
}) {
  const store = useAppState();
  const cardH = useRef(64);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef(false);
  const dragging = useRef(false);
  const startIndex = useRef(0);
  const canDrag = card.isWaiting && count > 1;

  // Live refs so the once-created responder always reads current values.
  const live = useRef({ id: card.id, staffId: card.staffId, index });
  live.current = { id: card.id, staffId: card.staffId, index };
  const setDragId = useRef(store.setDragId);
  setDragId.current = store.setDragId;
  const moveWithinSeat = useRef(store.moveWithinSeat);
  moveWithinSeat.current = store.moveWithinSeat;

  const disarm = () => {
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = null;
  };
  const endDrag = () => {
    disarm();
    dragging.current = false;
    armed.current = false;
    setDragId.current(null);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // Arm a long-press without capturing, so taps and scrolling still work.
      onStartShouldSetPanResponderCapture: () => {
        disarm();
        const armAt = Date.now();
        armTimer.current = setTimeout(() => {
          if (scrollAt.current > armAt) return; // user was scrolling, not holding
          armed.current = true;
          setDragId.current(live.current.id);
        }, 280);
        return false;
      },
      onMoveShouldSetPanResponder: () => armed.current,
      onMoveShouldSetPanResponderCapture: () => armed.current,
      onPanResponderGrant: () => {
        dragging.current = true;
        startIndex.current = live.current.index;
      },
      onPanResponderMove: (_e, g) => {
        if (!dragging.current) return;
        const steps = Math.round(g.dy / (cardH.current + 10));
        moveWithinSeat.current(live.current.staffId, live.current.id, startIndex.current + steps);
      },
      onPanResponderRelease: endDrag,
      onPanResponderTerminate: endDrag,
    }),
  ).current;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => (cardH.current = e.nativeEvent.layout.height)}
      {...(canDrag ? responder.panHandlers : {})}>
      <QueueCard
        card={card}
        showSeat={false}
        dragging={store.dragId === card.id}
        onPress={() => {
          disarm();
          if (armed.current && !dragging.current) {
            armed.current = false;
            setDragId.current(null);
            return;
          }
          if (store.dragId) return;
          onOpen();
        }}
      />
    </View>
  );
}

function SeatHeader({ group }: { group: SeatGroupVM }) {
  const { colors, radius, fontFamily, fontSize } = useTheme();
  const resolveColor = useServiceColor();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 2, paddingTop: 4, paddingBottom: 14 }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.md,
          backgroundColor: resolveColor(group.color),
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: 15, color: '#fff' }}>{group.initials}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fontFamily.bold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>{group.name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: fontFamily.regular, fontSize: fontSize.caption, color: colors.textMuted, marginTop: 4 }}>
          {group.subLine}
        </Text>
      </View>
      <WaitBadge group={group} />
    </View>
  );
}

function WaitBadge({ group }: { group: SeatGroupVM }) {
  const { colors, radius, fontFamily, fontSize } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: radius.pill,
        backgroundColor: group.free ? colors.successSoft : colors.surfaceSunken,
      }}>
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.caption, color: group.free ? colors.successSoftFg : colors.textBody }}>
        {group.waitBadge}
      </Text>
    </View>
  );
}

export function Queue() {
  const { colors, radius, fontFamily, fontSize, shadow } = useTheme();
  const resolveColor = useServiceColor();
  const store = useAppState();
  const scrollAt = useRef(0);

  const groupsAll = buildSeatGroups(store.queue, store.staff, store.services);
  const active = store.queue.filter((q) => q.status === 'waiting' || q.status === 'in-service');
  const waitingCount = store.queue.filter((q) => q.status === 'waiting').length;
  const allView = store.queueStaff === 'all';
  const groups = groupsAll.filter((g) => allView || store.queueStaff === g.id);

  const chips = [{ id: 'all', label: 'All', count: waitingCount }].concat(
    groupsAll.map((g) => ({ id: g.id, label: g.name, count: g.waitN })),
  );

  const summary =
    store.dragId != null
      ? 'Drop to reorder this seat'
      : `${store.staff.length} seats · ${active.length} in queue`;

  return (
    <>
      <Header
        title="Queue"
        subtitle={summary}
        action={
          <Button variant="primary" size="sm" onPress={store.openWalkin} leadingIcon={<Icon name="plus" size={16} color="#fff" />}>
            Walk-in
          </Button>
        }
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingBottom: 10 }}>
        {chips.map((ch) => {
          const on = store.queueStaff === ch.id;
          return (
            <Pressable
              key={ch.id}
              onPress={() => store.setQueueStaff(ch.id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 13,
                paddingVertical: 8,
                borderRadius: radius.pill,
                backgroundColor: on ? colors.primary : colors.surfaceCard,
                borderWidth: on ? 0 : 1,
                borderColor: colors.borderSubtle,
              }}>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: on ? '#fff' : colors.textBody }}>
                {ch.label}
              </Text>
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 999,
                  backgroundColor: on ? 'rgba(255,255,255,0.25)' : colors.surfaceSunken,
                }}>
                <Text style={{ fontFamily: fontFamily.bold, fontSize: 11, color: on ? '#fff' : colors.textMuted }}>{ch.count}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {store.dragId != null && (
        <View style={{ marginHorizontal: 20, marginBottom: 8, backgroundColor: colors.primarySoft, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: fontSize.bodySm, color: colors.primarySoftFg }}>
            Drag up or down · release to drop in this seat
          </Text>
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={store.dragId == null}
        onScrollBeginDrag={() => (scrollAt.current = Date.now())}>
        {allView ? (
          <View style={{ gap: 10 }}>
            {groups.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => store.setQueueStaff(g.id)}
                style={[
                  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surfaceCard, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.lg, padding: 14 },
                  shadow.xs,
                ]}>
                <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: resolveColor(g.color), alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: fontFamily.bold, fontSize: 17, color: '#fff' }}>{g.initials}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fontFamily.bold, fontSize: fontSize.bodyMd, color: colors.textStrong }}>{g.name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 4 }}>
                    {g.subLine}
                  </Text>
                </View>
                <WaitBadge group={g} />
                <Icon name="chevronRight" size={18} color={colors.textSubtle} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={{ gap: 18 }}>
            {groups.map((g) => {
              const waitCount = g.cards.filter((c) => c.isWaiting).length;
              let waitIdx = -1;
              return (
                <View key={g.id}>
                  <SeatHeader group={g} />
                  <View style={{ gap: 10 }}>
                    {g.cards.map((c) => {
                      const entry = store.queue.find((q) => q.id === c.id);
                      if (c.isWaiting) {
                        waitIdx += 1;
                        return (
                          <DraggableCard
                            key={c.id}
                            card={c}
                            index={waitIdx}
                            count={waitCount}
                            onOpen={() => entry && store.openDetail(entry)}
                            scrollAt={scrollAt}
                          />
                        );
                      }
                      return <QueueCard key={c.id} card={c} showSeat={false} onPress={() => entry && store.openDetail(entry)} />;
                    })}
                    {g.empty && (
                      <View style={{ borderWidth: 1, borderColor: colors.borderDefault, borderStyle: 'dashed', borderRadius: radius.lg, padding: 14 }}>
                        <Text style={{ textAlign: 'center', fontFamily: fontFamily.regular, fontSize: fontSize.bodySm, color: colors.textSubtle }}>
                          Seat free · add a walk-in
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </>
  );
}
