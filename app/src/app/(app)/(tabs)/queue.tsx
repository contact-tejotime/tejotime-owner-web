import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
} from 'react-native';

import { QueueCard } from '@/components/cards/QueueCard';
import { TButton, THeader, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { t, format } from '@/i18n';
import { CardVM, SeatGroupVM } from '@/lib/queue';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';

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

  const live = useRef({ id: card.id, staffId: card.staffId, index });
  const setDragId = useRef(store.setDragId);
  const moveWithinSeat = useRef(store.moveWithinSeat);
  const commitMove = useRef(store.commitMove);

  useEffect(() => {
    live.current = { id: card.id, staffId: card.staffId, index };
    setDragId.current = store.setDragId;
    moveWithinSeat.current = store.moveWithinSeat;
    commitMove.current = store.commitMove;
  });

  const disarm = () => {
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = null;
  };
  const endDrag = () => {
    disarm();
    const wasDragging = dragging.current;
    dragging.current = false;
    armed.current = false;
    setDragId.current(null);
    if (wasDragging) commitMove.current(live.current.staffId, live.current.id);
  };

  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => {
        disarm();
        const armAt = Date.now();
        armTimer.current = setTimeout(() => {
          if (scrollAt.current > armAt) return;
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
  );

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

function SeatHeader({ group, s }: { group: SeatGroupVM; s: ReturnType<typeof createQueueStyles> }) {
  const resolveColor = useServiceColor();
  return (
    <View style={s.seatHeader}>
      <View style={queueAvatarStyle(s.seatHeaderAvatar, resolveColor(group.color))}>
        <TText weight="bold" style={s.seatHeaderAvatarText}>
          {group.initials}
        </TText>
      </View>
      <View style={s.seatHeaderBody}>
        <TText variant="bodyMd" color="textStrong" weight="bold">
          {group.name}
        </TText>
        <TText variant="caption" color="textMuted" numberOfLines={1} style={s.seatHeaderSubline}>
          {group.subLine}
        </TText>
      </View>
      <WaitBadge group={group} s={s} />
    </View>
  );
}

function WaitBadge({ group, s }: { group: SeatGroupVM; s: ReturnType<typeof createQueueStyles> }) {
  return (
    <View style={queueWaitBadgeStyle(s, group.free)}>
      <TText variant="caption" weight="semibold" color={group.free ? 'successSoftFg' : 'textBody'}>
        {group.waitBadge}
      </TText>
    </View>
  );
}

export default function Queue() {
  const theme = useTheme();
  const resolveColor = useServiceColor();
  const store = useAppState();
  const scrollAt = useRef(0);
  const s = useMemo(() => createQueueStyles(theme), [theme]);

  const groupsAll = store.seats;
  const allView = store.queueStaff === 'all';

  const { activeCount, groups, chips } = useMemo(() => {
    const active = groupsAll.reduce((n, g) => n + g.cards.length, 0);
    const waiting = groupsAll.reduce((n, g) => n + g.waitN, 0);
    return {
      activeCount: active,
      groups: groupsAll.filter((g) => allView || store.queueStaff === g.id),
      chips: [{ id: 'all', label: t.queue.all, count: waiting }].concat(
        groupsAll.map((g) => ({ id: g.id, label: g.name, count: g.waitN })),
      ),
    };
  }, [groupsAll, allView, store.queueStaff]);

  const summary =
    store.dragId != null
      ? t.queue.dropToReorder
      : format(t.queue.summary, { seats: groupsAll.length, active: activeCount });

  return (
    <>
      <THeader
        title={t.queue.title}
        subtitle={summary}
        action={
          <TButton variant="primary" size="sm" onPress={store.openWalkin} leadingIcon={<Icon name="plus" size={16} color="#fff" />}>
            {t.queue.walkIn}
          </TButton>
        }
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipScroll}
        contentContainerStyle={s.chipScrollContent}>
        {chips.map((ch) => {
          const on = store.queueStaff === ch.id;
          return (
            <Pressable key={ch.id} onPress={() => store.setQueueStaff(ch.id)} style={queueChipStyle(s, on)}>
              <TText variant="bodySm" weight="semibold" style={queueChipLabelStyle(s, on) as TextStyle}>
                {ch.label}
              </TText>
              <View style={queueChipCountStyle(s, on)}>
                <TText weight="bold" style={queueChipCountTextStyle(s, on) as StyleProp<TextStyle>}>
                  {ch.count}
                </TText>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {store.dragId != null && (
        <View style={s.dragBanner}>
          <TText variant="bodySm" color="primarySoftFg" weight="semibold">
            {t.queue.dragHint}
          </TText>
        </View>
      )}

      <ScrollView
        style={s.mainScroll}
        contentContainerStyle={s.mainScrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={store.dragId == null}
        onScrollBeginDrag={() => (scrollAt.current = Date.now())}
        refreshControl={
          <RefreshControl
            refreshing={store.refreshing}
            onRefresh={store.refresh}
            enabled={store.dragId == null}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }>
        {groups.length === 0 ? (
          <TText variant="bodySm" color="textMuted" align="center" style={styles.pt6}>
            {t.queue.empty}
          </TText>
        ) : allView ? (
          <View style={s.seatList}>
            {groups.map((g) => (
              <Pressable key={g.id} onPress={() => store.setQueueStaff(g.id)} style={s.seatRow}>
                <View style={queueAvatarStyle(s.seatAvatar, resolveColor(g.color))}>
                  <TText weight="bold" style={s.seatAvatarText}>
                    {g.initials}
                  </TText>
                </View>
                <View style={s.seatBody}>
                  <TText variant="bodyMd" color="textStrong" weight="bold">
                    {g.name}
                  </TText>
                  <TText variant="bodySm" color="textMuted" numberOfLines={1} style={s.seatSubline}>
                    {g.subLine}
                  </TText>
                </View>
                <WaitBadge group={g} s={s} />
                <Icon name="chevronRight" size={18} color={theme.colors.textSubtle} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={s.groupList}>
            {groups.map((g) => {
              const waitCount = g.cards.filter((c) => c.isWaiting).length;
              let waitIdx = -1;
              return (
                <View key={g.id}>
                  <SeatHeader group={g} s={s} />
                  <View style={s.cardList}>
                    {g.cards.map((c) => {
                      if (c.isWaiting) {
                        waitIdx += 1;
                        return (
                          <DraggableCard
                            key={c.id}
                            card={c}
                            index={waitIdx}
                            count={waitCount}
                            onOpen={() => store.openDetail(c.id)}
                            scrollAt={scrollAt}
                          />
                        );
                      }
                      return <QueueCard key={c.id} card={c} showSeat={false} onPress={() => store.openDetail(c.id)} />;
                    })}
                    {g.empty && (
                      <View style={s.emptySeat}>
                        <TText variant="bodySm" color="textSubtle" align="center">
                          {t.queue.seatFree}
                        </TText>
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

const createQueueStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    chipScroll: { flexGrow: 0 },
    chipScrollContent: { ...styles.g2, ...styles.screenPadding, ...styles.pb2 },
    chip: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g1,
      paddingHorizontal: moderateScale(13),
      paddingVertical: moderateScale(8),
      borderRadius: moderateScale(radius.pill),
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
    },
    chipOn: {
      backgroundColor: colors.primary,
      borderWidth: 0,
    },
    chipLabelOn: { color: '#fff' },
    chipLabelOff: { color: colors.textBody },
    chipCount: {
      paddingHorizontal: moderateScale(6),
      paddingVertical: moderateScale(2),
      borderRadius: moderateScale(999),
      backgroundColor: colors.surfaceSunken,
    },
    chipCountOn: { backgroundColor: 'rgba(255,255,255,0.25)' },
    chipCountText: { fontSize: moderateScale(11), color: colors.textMuted },
    chipCountTextOn: { color: '#fff' },
    dragBanner: {
      ...styles.mh5,
      ...styles.mb2,
      backgroundColor: colors.primarySoft,
      borderRadius: moderateScale(radius.md),
      ...styles.ph3,
      ...styles.pv2,
    },
    mainScroll: { ...styles.flex },
    mainScrollContent: { ...styles.screenPadding, ...styles.pt2, ...styles.pb6 },
    seatList: { ...styles.g2 },
    seatRow: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g3,
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      padding: moderateScale(14),
      ...shadow.xs,
    },
    seatAvatar: {
      ...styles.nonFlexCenter,
      width: moderateScale(42),
      height: moderateScale(42),
      borderRadius: moderateScale(radius.md),
    },
    seatAvatarText: { fontSize: moderateScale(17), color: '#fff' },
    seatBody: { ...styles.flex, ...styles.minWidth0 },
    seatSubline: { ...styles.mt1 },
    groupList: { gap: moderateScale(18) },
    emptySeat: {
      borderWidth: moderateScale(1),
      borderColor: colors.borderDefault,
      borderStyle: 'dashed',
      borderRadius: moderateScale(radius.lg),
      padding: moderateScale(14),
    },
    seatHeader: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(11),
      paddingHorizontal: moderateScale(2),
      paddingTop: moderateScale(4),
      paddingBottom: moderateScale(14),
    },
    seatHeaderAvatar: {
      ...styles.nonFlexCenter,
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(radius.md),
    },
    seatHeaderAvatarText: { fontSize: moderateScale(15), color: '#fff' },
    seatHeaderBody: { ...styles.flex, ...styles.minWidth0 },
    seatHeaderSubline: { ...styles.mt1 },
    waitBadge: {
      paddingHorizontal: moderateScale(10),
      paddingVertical: moderateScale(5),
      borderRadius: moderateScale(radius.pill),
    },
    waitBadgeFree: { backgroundColor: colors.successSoft },
    waitBadgeBusy: { backgroundColor: colors.surfaceSunken },
    cardList: { ...styles.g2 },
  });

const queueAvatarStyle = (
  base: ReturnType<typeof createQueueStyles>['seatHeaderAvatar'],
  backgroundColor: string,
) => [base, { backgroundColor }];

const queueWaitBadgeStyle = (s: ReturnType<typeof createQueueStyles>, free: boolean) =>
  [s.waitBadge, free ? s.waitBadgeFree : s.waitBadgeBusy];

const queueChipStyle = (s: ReturnType<typeof createQueueStyles>, on: boolean) => [s.chip, on ? s.chipOn : null];

const queueChipCountStyle = (s: ReturnType<typeof createQueueStyles>, on: boolean) =>
  [s.chipCount, on ? s.chipCountOn : null];

const queueChipLabelStyle = (s: ReturnType<typeof createQueueStyles>, on: boolean) =>
  on ? s.chipLabelOn : s.chipLabelOff;

const queueChipCountTextStyle = (s: ReturnType<typeof createQueueStyles>, on: boolean) =>
  [s.chipCountText, on ? s.chipCountTextOn : null];
