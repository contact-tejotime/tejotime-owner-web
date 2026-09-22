import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { TButton, TText } from "@/components/common";
import { splashMark } from "@/components/common/TSplashScreen";
import { ART_HEIGHT, ART_WIDTH, OnboardingArt, type OnboardingArtKind } from "@/components/onboarding/OnboardingArt";
import { Icon } from "@/components/ui/Icon";
import { format, t } from "@/i18n";
import { useAppState } from "@/state/store";
import { styles } from "@/styles";
import { moderateScale } from "@/styles/scale";
import type { ThemeStyleProps } from "@/styles/types";
import { useTheme } from "@/theme/ThemeProvider";

/** In reading order. Each page's copy lives in `onboarding.slides.<kind>` in en.json. */
const PAGES: OnboardingArtKind[] = ["queue", "bookings", "customers", "share"];

/** The text column and button never grow past this, so a tablet reads like a phone, only roomier. */
const CONTENT_MAX_WIDTH = 440;
/** The art may grow a little past its design size on a big screen, and shrink on a small one. */
const ART_MAX_SCALE = 1.3;
const ART_MIN_SCALE = 0.62;

/**
 * First-run tour, shown once per install before sign-in (see `index.tsx` and `onboarded` in the
 * store). Four pages, each a miniature of a real screen: the live queue, bookings, customers and
 * reports, and the shareable booking page. Skip and Get started both mark it seen and hand over
 * to sign-in.
 *
 * The pager is a paging ScrollView, not a FlatList: four fixed pages need no virtualisation. Its
 * scroll position drives everything on the UI thread (art parallax, text fade, the dots). Only
 * the page index, which picks the button label and the Skip visibility, round-trips to React.
 *
 * Pages are as wide as the pager's *measured* width, not the window's. In tablet landscape the
 * safe area insets the sides, and a window-wide page would never snap back to centre.
 *
 * Owner-facing, but deliberately **mobile only**: a first-run tour belongs to installing an app.
 * owner-web users arrive at a sign-in page from a link and have no equivalent moment.
 */
export default function Onboarding() {
  const theme = useTheme();
  const { colors } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const { completeOnboarding } = useAppState();

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(0);
  const pageWidthSV = useSharedValue(1);
  const [page, setPage] = useState({ width: 0, height: 0 });
  const pageWidth = page.width;
  const [index, setIndex] = useState(0);
  /** The index as of the last commit, for the re-seat effect below, which must not re-run per page. */
  const indexRef = useRef(0);
  const last = index === PAGES.length - 1;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
    onMomentumEnd: (e) => {
      runOnJS(setIndex)(Math.round(e.contentOffset.x / pageWidthSV.value));
    },
  });

  // Pages take the pager's measured size explicitly. A `flex: 1` child of a horizontal ScrollView
  // has no definite height to fill, so it would collapse to its content.
  const onPagerLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && (width !== page.width || height !== page.height)) {
      pageWidthSV.value = width;
      setPage({ width, height });
    }
  };

  // A rotation or a Split View resize changes the page width. Re-seat the current page at its new
  // offset, or the pager would sit straddling two pages.
  useEffect(() => {
    if (pageWidth > 0) scrollRef.current?.scrollTo({ x: indexRef.current * pageWidth, animated: false });
  }, [pageWidth, scrollRef]);

  const finish = () => {
    completeOnboarding();
    router.replace("/(auth)/login");
  };

  const next = () => {
    if (last) {
      finish();
      return;
    }
    const to = index + 1;
    // Set now rather than waiting for momentum-end: a programmatic scroll does not reliably report
    // one on Android, and the label should flip as the page moves, not after.
    setIndex(to);
    scrollRef.current?.scrollTo({ x: to * pageWidth, animated: true });
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.surfacePage }]} edges={["top", "bottom", "left", "right"]}>
      <View style={[s.header, s.column]}>
        <View style={s.brand}>
          <Image source={splashMark} style={s.brandMark} contentFit="contain" />
          <TText variant="bodyLg" weight="extrabold" color="textStrong">
            {t.common.brand}
          </TText>
        </View>
        {/* Kept in the layout on the last page, just hidden, so the header doesn't jump. */}
        <Pressable
          onPress={finish}
          disabled={last}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityElementsHidden={last}
          style={[s.skip, last && s.hidden]}>
          <TText variant="bodyMd" weight="semibold" color="textMuted">
            {t.onboarding.skip}
          </TText>
        </Pressable>
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={onPagerLayout}
        style={styles.flex}>
        {pageWidth > 0
          ? PAGES.map((kind, i) => (
              <Page key={kind} kind={kind} index={i} width={page.width} height={page.height} scrollX={scrollX} s={s} />
            ))
          : null}
      </Animated.ScrollView>

      <View style={[s.footer, s.column]}>
        <View
          style={s.dots}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={format(t.onboarding.progress, { n: index + 1, total: PAGES.length })}>
          {PAGES.map((kind, i) => (
            <Dot key={kind} index={i} scrollX={scrollX} pageWidth={pageWidthSV} s={s} />
          ))}
        </View>
        <TButton
          variant="primary"
          size="lg"
          fullWidth
          onPress={next}
          trailingIcon={<Icon name="arrowRight" size={20} color={colors.textOnBrand} />}>
          {last ? t.onboarding.getStarted : t.onboarding.next}
        </TButton>
      </View>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof createStyles>;

function Page({
  kind,
  index,
  width,
  height,
  scrollX,
  s,
}: {
  kind: OnboardingArtKind;
  index: number;
  width: number;
  height: number;
  scrollX: SharedValue<number>;
  s: Styles;
}) {
  const copy = t.onboarding.slides[kind];
  const [artBox, setArtBox] = useState({ w: 0, h: 0 });
  /** This page's offset from the viewport, in pages: 0 centred, ±1 one page away. */
  const progress = useDerivedValue(() => (scrollX.value - index * width) / width);

  const textStyle = useAnimatedStyle(() => {
    const d = Math.min(Math.abs(progress.value), 1);
    return { opacity: Math.max(0, 1 - d * 1.4), transform: [{ translateX: -progress.value * width * 0.18 }] };
  });

  const artScale = artBox.w > 0 ? Math.max(ART_MIN_SCALE, Math.min(ART_MAX_SCALE, artBox.w / ART_WIDTH, artBox.h / ART_HEIGHT)) : 0;

  return (
    <View style={{ width, height }}>
      <View style={[s.column, s.pageColumn]}>
        <View style={s.artArea} onLayout={(e) => setArtBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {artScale > 0 ? (
            <View style={{ transform: [{ scale: artScale }] }}>
              <OnboardingArt kind={kind} progress={progress} />
            </View>
          ) : null}
        </View>
        <Animated.View style={[s.copy, textStyle]}>
          <TText variant="h3" color="textStrong" weight="extrabold" align="center" style={s.title}>
            {copy.title}
          </TText>
          <TText variant="bodyMd" color="textMuted" align="center" style={s.body}>
            {copy.body}
          </TText>
        </Animated.View>
      </View>
    </View>
  );
}

/** Stretches into a pill as its page centres, and takes the brand colour. */
function Dot({
  index,
  scrollX,
  pageWidth,
  s,
}: {
  index: number;
  scrollX: SharedValue<number>;
  pageWidth: SharedValue<number>;
  s: Styles;
}) {
  const { colors } = useTheme();
  const a = useAnimatedStyle(() => {
    const p = scrollX.value / pageWidth.value - index;
    return {
      width: interpolate(p, [-1, 0, 1], [8, 26, 8], Extrapolation.CLAMP),
      backgroundColor: interpolateColor(Math.min(Math.abs(p), 1), [0, 1], [colors.primary, colors.borderDefault]),
    };
  });
  return <Animated.View style={[s.dot, a]} />;
}

const createStyles = ({ colors }: ThemeStyleProps) =>
  StyleSheet.create({
    column: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" },
    header: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.justifyBetween,
      paddingHorizontal: moderateScale(20),
      paddingTop: moderateScale(8),
      paddingBottom: moderateScale(4),
    },
    brand: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(8) },
    brandMark: { width: moderateScale(30), height: moderateScale(30) },
    skip: { paddingVertical: moderateScale(6), paddingHorizontal: moderateScale(4) },
    hidden: { opacity: 0 },

    pageColumn: { flex: 1, paddingHorizontal: moderateScale(24) },
    artArea: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: ART_HEIGHT * ART_MIN_SCALE },
    copy: { paddingTop: moderateScale(8), paddingBottom: moderateScale(12) },
    title: { letterSpacing: -0.5 },
    body: { marginTop: moderateScale(10), lineHeight: moderateScale(22) },

    footer: {
      paddingHorizontal: moderateScale(24),
      paddingTop: moderateScale(8),
      paddingBottom: moderateScale(12),
      gap: moderateScale(20),
    },
    dots: { ...styles.flexRow, ...styles.justifyCenter, ...styles.itemsCenter, gap: moderateScale(6) },
    dot: { height: 8, borderRadius: 4, backgroundColor: colors.borderDefault },
  });
