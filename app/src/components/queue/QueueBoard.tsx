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
import { TButton, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { CardVM, SeatGroupVM } from '@/lib/queue';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';

type SeatLayout = { y: number; height: number; headerH: number };
type DropTarget = { seatId: string; toIndex: number };

function DraggableCard({
  card,
  index,
  count,
  canCrossSeat,
  onOpen,
  scrollAt,
  seatLayouts,
  remasureSeats,
  dropTarget,
  onDropTarget,
}: {
  card: CardVM;
  index: number;
  count: number;
  canCrossSeat: boolean;
  onOpen: () => void;
  scrollAt: React.MutableRefObject<number>;
  seatLayouts: React.MutableRefObject<Record<string, SeatLayout>>;
  remasureSeats: () => void;
  dropTarget: DropTarget | null;
  onDropTarget: (next: DropTarget | null) => void;
}) {
  const store = useAppState();
  const cardH = useRef(64);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef(false);
  const dragging = useRef(false);
  const startIndex = useRef(0);
  const startStaffId = useRef(card.staffId);
  const canDrag = card.isWaiting && (count > 1 || canCrossSeat);

  const live = useRef({ id: card.id, staffId: card.staffId, index });
  const dropRef = useRef(dropTarget);
  const setDragId = useRef(store.setDragId);
  const moveWithinSeat = useRef(store.moveWithinSeat);
  const moveCardToSeat = useRef(store.moveCardToSeat);
  const commitMove = useRef(store.commitMove);
  const commitCrossSeatMove = useRef(store.commitCrossSeatMove);
  const seatsRef = useRef(store.seats);
  const onDropTargetRef = useRef(onDropTarget);
  const remasureRef = useRef(remasureSeats);

  useEffect(() => {
    live.current = { id: card.id, staffId: card.staffId, index };
    dropRef.current = dropTarget;
    setDragId.current = store.setDragId;
    moveWithinSeat.current = store.moveWithinSeat;
    moveCardToSeat.current = store.moveCardToSeat;
    commitMove.current = store.commitMove;
    commitCrossSeatMove.current = store.commitCrossSeatMove;
    seatsRef.current = store.seats;
    onDropTargetRef.current = onDropTarget;
    remasureRef.current = remasureSeats;
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
    const pending = dropRef.current;
    onDropTargetRef.current(null);
    if (!wasDragging) return;

    const { id } = live.current;
    const originSeat = startStaffId.current;

    // Cross-seat: apply optimistic splice only on release so the card is not remounted mid-drag.
    if (pending && pending.seatId !== originSeat) {
      moveCardToSeat.current(originSeat, pending.seatId, id, pending.toIndex);
      commitCrossSeatMove.current(id, pending.seatId, pending.toIndex);
      return;
    }

    const seatId = pending?.seatId ?? live.current.staffId;
    commitMove.current(seatId, id);
  };

  const resolveDrop = (moveY: number): DropTarget | null => {
    const layouts = seatLayouts.current;
    for (const seat of seatsRef.current) {
      const layout = layouts[seat.id];
      if (!layout) continue;
      if (moveY < layout.y || moveY > layout.y + layout.height) continue;
      const relative = moveY - layout.y - layout.headerH;
      const gap = cardH.current + 10;
      const waiting = seat.cards.filter((c) => c.isWaiting && c.id !== live.current.id);
      let toIndex = Math.max(0, Math.round(relative / gap));
      toIndex = Math.max(0, Math.min(waiting.length, toIndex));
      return { seatId: seat.id, toIndex };
    }
    return null;
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
          remasureRef.current();
          setDragId.current(live.current.id);
        }, 280);
        return false;
      },
      onMoveShouldSetPanResponder: () => armed.current,
      onMoveShouldSetPanResponderCapture: () => armed.current,
      onPanResponderGrant: () => {
        dragging.current = true;
        startIndex.current = live.current.index;
        startStaffId.current = live.current.staffId;
        remasureRef.current();
      },
      onPanResponderMove: (_e, g) => {
        if (!dragging.current) return;
        remasureRef.current();
        const hit = resolveDrop(g.moveY);
        if (!hit) {
          onDropTargetRef.current(null);
          const steps = Math.round(g.dy / (cardH.current + 10));
          moveWithinSeat.current(live.current.staffId, live.current.id, startIndex.current + steps);
          return;
        }
        if (hit.seatId === startStaffId.current) {
          onDropTargetRef.current(null);
          moveWithinSeat.current(live.current.staffId, live.current.id, hit.toIndex);
          return;
        }
        // Other seat: hover only (do not splice yet — remount would kill the gesture).
        onDropTargetRef.current(hit);
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

function DropSlot({ active, s }: { active: boolean; s: ReturnType<typeof createQueueStyles> }) {
  if (!active) return null;
  return <View style={s.dropSlot} />;
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

/**
 * Live queue board (filters, Walk-in, seat cards). Used on Home; the old Queue tab redirects here.
 * Long-press drag reorders within a seat or drops onto another seat (Kanban).
 */
export function QueueBoard() {
  const theme = useTheme();
  const store = useAppState();
  const scrollAt = useRef(0);
  const seatLayouts = useRef<Record<string, SeatLayout>>({});
  const seatNodes = useRef<Record<string, View | null>>({});
  const headerH = useRef(48);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const s = useMemo(() => createQueueStyles(theme), [theme]);

  const groupsAll = store.seats;
  const isStaff = store.session?.role === 'staff';
  const hideAllChip = isStaff || groupsAll.length <= 1;
  const allView = !hideAllChip && store.queueStaff === 'all';
  const canCrossSeat = allView && groupsAll.length > 1;

  const remasureSeats = () => {
    for (const id of Object.keys(seatNodes.current)) {
      seatNodes.current[id]?.measureInWindow((_x, y, _w, height) => {
        seatLayouts.current[id] = { y, height, headerH: headerH.current };
      });
    }
  };

  const { groups, chips, waitingTotal } = useMemo(() => {
    const waiting = groupsAll.reduce((n, g) => n + g.waitN, 0);
    const seatChips = groupsAll.map((g) => ({ id: g.id, label: g.name, count: g.waitN }));
    return {
      // Staff (and single-seat) already get a scoped seat list from the API — show it as-is.
      groups: hideAllChip
        ? groupsAll
        : groupsAll.filter((g) => allView || store.queueStaff === g.id),
      chips: hideAllChip ? seatChips : [{ id: 'all', label: t.queue.all, count: waiting }, ...seatChips],
      waitingTotal: waiting,
    };
  }, [groupsAll, allView, store.queueStaff, hideAllChip]);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipScroll}
        contentContainerStyle={s.chipScrollContent}>
        {hideAllChip && groupsAll.length <= 1 ? (
          <View style={s.waitingPill}>
            <TText variant="bodySm" weight="bold" color="textStrong">
              {waitingTotal} waiting
            </TText>
          </View>
        ) : (
          chips.map((ch) => {
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
          })
        )}
        <TButton variant="primary" size="sm" onPress={store.openWalkin} leadingIcon={<Icon name="plus" size={16} color="#fff" />}>
          {t.queue.walkIn}
        </TButton>
      </ScrollView>

      {store.dragId != null && (
        <View style={s.dragBanner}>
          <TText variant="bodySm" color="primarySoftFg" weight="semibold">
            {canCrossSeat ? t.queue.dragHintCross : t.queue.dragHint}
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
        ) : (
          <View style={s.groupList}>
            {groups.map((g) => {
              const waitCount = g.cards.filter((c) => c.isWaiting).length;
              const isDropSeat = dropTarget?.seatId === g.id;
              const dropIdx = isDropSeat ? dropTarget!.toIndex : -1;
              let waitIdx = -1;
              const waitingCards = g.cards.filter((c) => c.isWaiting);
              const servingCards = g.cards.filter((c) => !c.isWaiting);

              return (
                <View
                  key={g.id}
                  style={[s.seatBoard, isDropSeat ? s.seatBoardDrop : null]}
                  ref={(node) => {
                    seatNodes.current[g.id] = node;
                  }}
                  onLayout={remasureSeats}>
                  <View
                    onLayout={(e) => {
                      headerH.current = e.nativeEvent.layout.height + moderateScale(12);
                      remasureSeats();
                    }}>
                    <SeatHeader group={g} s={s} />
                  </View>
                  <View style={s.cardList}>
                    {servingCards.map((c) => (
                      <QueueCard key={c.id} card={c} showSeat={false} onPress={() => store.openDetail(c.id)} />
                    ))}
                    {waitingCards.map((c, i) => {
                      waitIdx = i;
                      return (
                        <React.Fragment key={c.id}>
                          <DropSlot active={dropIdx === i} s={s} />
                          <DraggableCard
                            card={c}
                            index={waitIdx}
                            count={waitCount}
                            canCrossSeat={canCrossSeat}
                            onOpen={() => store.openDetail(c.id)}
                            scrollAt={scrollAt}
                            seatLayouts={seatLayouts}
                            remasureSeats={remasureSeats}
                            dropTarget={dropTarget}
                            onDropTarget={setDropTarget}
                          />
                        </React.Fragment>
                      );
                    })}
                    <DropSlot active={isDropSeat && dropIdx === waitingCards.length} s={s} />
                    {g.empty && !isDropSeat && (
                      <View style={s.emptySeat}>
                        <TText variant="bodySm" color="textSubtle" align="center">
                          {t.queue.seatFree}
                        </TText>
                      </View>
                    )}
                    {g.empty && isDropSeat && (
                      <TText variant="caption" color="primarySoftFg" align="center">
                        {t.queue.dropHere}
                      </TText>
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
    chipScrollContent: { ...styles.g2, ...styles.screenPadding, ...styles.pb2, ...styles.itemsCenter },
    waitingPill: {
      minHeight: moderateScale(34),
      paddingHorizontal: moderateScale(12),
      borderRadius: moderateScale(999),
      backgroundColor: colors.surfaceCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      ...styles.itemsCenter,
      ...styles.justifyCenter,
    },
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
    groupList: { gap: moderateScale(14) },
    seatBoard: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      padding: moderateScale(12),
      ...shadow.xs,
    },
    seatBoardDrop: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    dropSlot: {
      height: moderateScale(8),
      borderRadius: moderateScale(4),
      backgroundColor: colors.primary,
      opacity: 0.55,
    },
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
      paddingTop: moderateScale(2),
      paddingBottom: moderateScale(12),
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
