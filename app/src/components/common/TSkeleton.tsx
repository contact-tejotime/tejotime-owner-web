import React, { useEffect } from 'react';
import { AccessibilityInfo, DimensionValue, StyleProp, StyleSheet, ViewStyle } from 'react-native';
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
