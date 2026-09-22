import React, { useEffect } from 'react';
import { AccessibilityInfo, DimensionValue, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { moderateScale } from '@/styles/scale';
import { useTheme } from '@/theme/ThemeProvider';

const PULSE_MS = 850;
const DIM = 0.45;

/**
 * One shimmering placeholder block.
 *
 * A pulsing opacity rather than a sweeping gradient: `expo-linear-gradient` is not a dependency,
 * and a masked sweep would need one. The pulse reads as "loading" just as clearly and costs a
 * single shared value per block, driven on the UI thread by reanimated — so a screen full of
 * these never touches the JS thread while the data request is in flight.
 *
 * Honours "reduce motion": the block still renders (the layout must not shift for those users),
 * it simply holds a steady mid-opacity instead of pulsing.
 */
export function TSkeleton({
  width = '100%',
  height = 14,
  radius,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  /** Defaults to a pill for short blocks, a small rounded rect for taller ones. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const progress = useSharedValue(DIM);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (!alive || reduced) return;
        progress.value = withRepeat(
          withTiming(1, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
          -1,
          true,
        );
      })
      .catch(() => {
        /* Platform refused to answer — leave the block static rather than crash a loading screen. */
      });
    return () => {
      alive = false;
      cancelAnimation(progress);
    };
  }, [progress]);

  const pulse = useAnimatedStyle(() => ({ opacity: progress.value }));
  const h = moderateScale(height);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height: h,
          borderRadius: moderateScale(radius ?? (height <= 24 ? 999 : 10)),
          backgroundColor: colors.surfaceSunken,
        },
        pulse,
        style,
      ]}
    />
  );
}

/**
 * The skeleton for one `CustomerCard` — same frame, padding and internal rhythm, so the list does
 * not jump when the real rows replace it.
 */
export function TCustomerCardSkeleton() {
  const { colors, radius, shadow } = useTheme();
  const s = createSkeletonCardStyles(colors.surfaceCard, colors.borderSubtle, radius.lg, shadow.xs);

  return (
    <Animated.View style={s.card}>
      <Animated.View style={s.row}>
        <TSkeleton width={moderateScale(48)} height={48} radius={24} />
        <Animated.View style={s.body}>
          <TSkeleton width="55%" height={15} />
          <TSkeleton width="40%" height={12} style={s.phone} />
        </Animated.View>
      </Animated.View>
      <Animated.View style={s.metaRow}>
        {[0, 1, 2].map((i) => (
          <Animated.View key={i} style={s.metaCell}>
            <TSkeleton width={moderateScale(34)} height={15} />
            <TSkeleton width={moderateScale(52)} height={11} style={s.metaLabel} />
          </Animated.View>
        ))}
      </Animated.View>
    </Animated.View>
  );
}

const createSkeletonCardStyles = (
  surfaceCard: string,
  borderSubtle: string,
  radiusLg: number,
  shadowXs: object,
) =>
  StyleSheet.create({
    card: {
      backgroundColor: surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: borderSubtle,
      borderRadius: moderateScale(radiusLg),
      padding: moderateScale(16),
      ...shadowXs,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: moderateScale(12) },
    body: { flex: 1, minWidth: 0, gap: moderateScale(6) },
    phone: { marginTop: moderateScale(2) },
    metaRow: {
      flexDirection: 'row',
      gap: moderateScale(20),
      marginTop: moderateScale(16),
      paddingTop: moderateScale(12),
      borderTopWidth: moderateScale(1),
      borderTopColor: borderSubtle,
    },
    metaCell: { gap: moderateScale(6) },
    metaLabel: { marginTop: moderateScale(2) },
  });

/**
 * One `QueueCard`-shaped row: number badge, name, a sub-line, and a status pill on the right.
 * Also stands in for the Reports staff and queue rows. Their real cards are close enough in height
 * that the swap does not visibly jump.
 */
export function TQueueRowSkeleton() {
  const { colors, radius } = useTheme();
  return (
    <View
      style={[
        rowSkeletonStyles.row,
        {
          backgroundColor: colors.surfaceCard,
          borderColor: colors.borderSubtle,
          borderRadius: moderateScale(radius.lg),
        },
      ]}>
      <TSkeleton width={moderateScale(34)} height={34} radius={radius.md} />
      <View style={rowSkeletonStyles.body}>
        <TSkeleton width="60%" height={14} />
        <TSkeleton width="38%" height={11} />
      </View>
      <TSkeleton width={moderateScale(44)} height={12} />
    </View>
  );
}

/**
 * One seat board on the Home queue: the seat header (avatar, name, sub-line, count pill) over two
 * queue rows. Same frame as `QueueBoard`'s `seatBoard`, so the real boards replace these in place.
 */
export function TSeatBoardSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors, radius, shadow } = useTheme();
  return (
    <View
      style={[
        seatSkeletonStyles.board,
        {
          backgroundColor: colors.surfaceCard,
          borderColor: colors.borderSubtle,
          borderRadius: moderateScale(radius.lg),
        },
        shadow.xs,
        style,
      ]}>
      <View style={seatSkeletonStyles.header}>
        <TSkeleton width={moderateScale(36)} height={36} radius={radius.md} />
        <View style={rowSkeletonStyles.body}>
          <TSkeleton width="50%" height={15} />
          <TSkeleton width="70%" height={11} />
        </View>
        <TSkeleton width={moderateScale(52)} height={24} />
      </View>
      <View style={seatSkeletonStyles.rows}>
        <TQueueRowSkeleton />
        <TQueueRowSkeleton />
      </View>
    </View>
  );
}

/** One `AppointmentListItem`: the time column beside a card with the brand-coloured left edge. */
export function TAppointmentRowSkeleton() {
  const { colors, radius } = useTheme();
  return (
    <View style={apptSkeletonStyles.row}>
      <View style={apptSkeletonStyles.time}>
        <TSkeleton width={moderateScale(44)} height={13} />
      </View>
      <View
        style={[
          apptSkeletonStyles.card,
          {
            backgroundColor: colors.surfaceCard,
            borderColor: colors.borderSubtle,
            borderLeftColor: colors.surfaceSunken,
            borderRadius: moderateScale(radius.md),
          },
        ]}>
        <View style={rowSkeletonStyles.body}>
          <TSkeleton width="55%" height={14} />
          <TSkeleton width="40%" height={11} />
        </View>
        <TSkeleton width={moderateScale(78)} height={32} radius={radius.md} />
      </View>
    </View>
  );
}

const rowSkeletonStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(11),
    padding: moderateScale(12),
    borderWidth: moderateScale(1),
  },
  body: { flex: 1, minWidth: 0, gap: moderateScale(7) },
});

const seatSkeletonStyles = StyleSheet.create({
  board: { borderWidth: moderateScale(1), padding: moderateScale(12) },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(11),
    paddingHorizontal: moderateScale(2),
    paddingTop: moderateScale(2),
    paddingBottom: moderateScale(12),
  },
  rows: { gap: moderateScale(8) },
});

const apptSkeletonStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: moderateScale(12) },
  time: { width: moderateScale(56), alignItems: 'flex-end', paddingTop: moderateScale(16) },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(8),
    borderWidth: moderateScale(1),
    borderLeftWidth: moderateScale(3),
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(16),
  },
});
