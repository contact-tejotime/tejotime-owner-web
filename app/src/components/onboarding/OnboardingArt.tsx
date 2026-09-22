import React, { useEffect, useMemo } from 'react';
import { StyleProp, StyleSheet, TextStyle, View, ViewStyle } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { TText } from '@/components/common/TText';
import { Icon, type IconName } from '@/components/ui/Icon';
import { format, t } from '@/i18n';
import { WEB_BASE_URL } from '@/lib/config';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

export type OnboardingArtKind = 'queue' | 'bookings' | 'customers' | 'share';

/**
 * Every scene is composed on this fixed canvas in plain dp, NOT `moderateScale`, and the screen
 * scales the whole canvas to the room it has. Scaling pieces individually would drift them apart
 * (text grows on one curve, cards on another) and break the composition.
 */
export const ART_WIDTH = 320;
export const ART_HEIGHT = 300;

/** Three up-and-down cycles (about 13 s), then still. */
const BOB_HALF_CYCLES = 6;

type ArtStyles = ReturnType<typeof createArtStyles>;
type Progress = SharedValue<number>;

/**
 * The illustration above each onboarding page: a miniature of the real screen that page describes,
 * drawn from the app's own theme tokens, so it matches the product and follows dark mode, with no
 * image assets to keep in sync.
 *
 * `progress` is this page's position relative to the viewport: 0 when centred, ±1 one page away.
 * The main card drifts gently with it and the floating chips drift further (parallax), shrinking
 * and fading as their page leaves. So each chip "arrives" as its page is swiped in.
 *
 * Purely decorative: hidden from screen readers. The page's title and body carry the meaning.
 */
export function OnboardingArt({ kind, progress }: { kind: OnboardingArtKind; progress: Progress }) {
  const theme = useTheme();
  const s = useMemo(() => createArtStyles(theme), [theme]);

  return (
    <View
      style={s.canvas}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Backdrop s={s} progress={progress} />
      {kind === 'queue' ? <QueueScene s={s} progress={progress} /> : null}
      {kind === 'bookings' ? <BookingsScene s={s} progress={progress} /> : null}
      {kind === 'customers' ? <CustomersScene s={s} progress={progress} /> : null}
      {kind === 'share' ? <ShareScene s={s} progress={progress} /> : null}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Motion
 * ---------------------------------------------------------------------------------------------- */

/** The page's main card: drifts a little with the swipe and settles as it centres. */
function Card({ progress, style, children }: { progress: Progress; style: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const a = useAnimatedStyle(() => {
    const p = progress.value;
    const d = Math.min(Math.abs(p), 1);
    return { transform: [{ translateX: -p * 24 }, { scale: 1 - d * 0.08 }] };
  });
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/**
 * A chip that floats over the card. `depth` sets how far it travels with the swipe relative to the
 * card (parallax). It bobs gently for a few cycles, then settles. Reduce Motion stops the bob. The
 * swipe-driven movement stays, because it follows the user's own finger.
 *
 * The bob is finite on purpose. A never-ending animation keeps the screen from ever going idle,
 * which stalls Android's UI tooling ("could not get idle state"). That includes Google Play's
 * pre-launch crawler, and it costs battery for no benefit once the owner has looked.
 */
function Float({
  progress,
  style,
  depth = 1,
  delay = 0,
  children,
}: {
  progress: Progress;
  style: StyleProp<ViewStyle>;
  depth?: number;
  delay?: number;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const bob = useSharedValue(0.5);

  useEffect(() => {
    if (reduceMotion) return;
    bob.value = withDelay(
      delay,
      // An even count ends back at the resting value.
      withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }), BOB_HALF_CYCLES, true),
    );
    return () => cancelAnimation(bob);
  }, [reduceMotion, delay, bob]);

  const a = useAnimatedStyle(() => {
    const p = progress.value;
    const d = Math.min(Math.abs(p), 1);
    return {
      opacity: 1 - d,
      transform: [
        { translateX: -p * 70 * depth },
        { translateY: (bob.value - 0.5) * 7 },
        { scale: 1 - d * 0.4 },
      ],
    };
  });
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** The soft disc and orbit ring behind every scene, with three accent dots riding the ring. */
function Backdrop({ s, progress }: { s: ArtStyles; progress: Progress }) {
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${progress.value * -40}deg` }] }));
  return (
    <>
      <View style={s.disc} />
      <Animated.View style={[s.ring, ring]}>
        <View style={[s.dot, s.dotA]} />
        <View style={[s.dot, s.dotB]} />
        <View style={[s.dot, s.dotC]} />
      </Animated.View>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Building blocks
 * ---------------------------------------------------------------------------------------------- */

/**
 * Text at a fixed size on the fixed canvas. The system text-size setting is off here
 * (`maxFontSizeMultiplier={1}`): the canvas already scales as a whole, and a label that outgrew
 * its card would break the picture without making anything more readable.
 */
function ArtText({
  size,
  weight = 'regular',
  color = 'textBody',
  style,
  children,
}: {
  size: number;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';
  color?: 'textStrong' | 'textBody' | 'textMuted' | 'textOnBrand' | 'primary' | 'successSoftFg' | 'primarySoftFg';
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
}) {
  return (
    <TText
      color={color}
      weight={weight}
      numberOfLines={1}
      maxFontSizeMultiplier={1}
      style={[{ fontSize: size, lineHeight: Math.round(size * 1.3) }, style]}>
      {children}
    </TText>
  );
}

function Chip({ s, icon, iconColor, iconBg, label }: { s: ArtStyles; icon: IconName; iconColor: string; iconBg: string; label: string }) {
  return (
    <View style={s.chip}>
      <View style={[s.chipIcon, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={14} color={iconColor} strokeWidth={2.4} />
      </View>
      <ArtText size={12} weight="semibold" color="textStrong">
        {label}
      </ArtText>
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Scenes
 * ---------------------------------------------------------------------------------------------- */

function QueueScene({ s, progress }: { s: ArtStyles; progress: Progress }) {
  const { colors } = useTheme();
  const rows = t.onboarding.art.queue;
  const waits = [12, 30];
  return (
    <>
      <Card progress={progress} style={[s.card, s.queueCard]}>
        <View style={s.row}>
          <View style={[s.avatarSquare, { backgroundColor: colors.primary }]}>
            <ArtText size={14} weight="bold" color="textOnBrand">
              {t.onboarding.art.seatName.charAt(0)}
            </ArtText>
          </View>
          <View style={s.grow}>
            <ArtText size={14} weight="bold" color="textStrong">
              {t.onboarding.art.seatName}
            </ArtText>
            <ArtText size={11} color="textMuted">
              {t.onboarding.art.seatSub}
            </ArtText>
          </View>
          <View style={[s.pill, { backgroundColor: colors.surfaceSunken }]}>
            <ArtText size={10} weight="semibold" color="textMuted">
              {t.onboarding.art.busy}
            </ArtText>
          </View>
        </View>
        <View style={s.stack}>
          {rows.map((r, i) => (
            <View key={r.token} style={[s.queueRow, i === 0 && { borderColor: colors.primary }]}>
              <View style={[s.token, { backgroundColor: i === 0 ? colors.primary : colors.surfaceSunken }]}>
                <ArtText size={10} weight="bold" color={i === 0 ? 'textOnBrand' : 'textMuted'}>
                  {r.token}
                </ArtText>
              </View>
              <View style={s.grow}>
                <ArtText size={12} weight="semibold" color="textStrong">
                  {r.name}
                </ArtText>
                <ArtText size={10} color="textMuted">
                  {r.service}
                </ArtText>
              </View>
              {i === 0 ? (
                <View style={s.row}>
                  <View style={[s.statusDot, { backgroundColor: colors.success }]} />
                  <ArtText size={10} weight="semibold" color="successSoftFg">
                    {t.status.inService}
                  </ArtText>
                </View>
              ) : (
                <ArtText size={10} weight="medium" color="textMuted">
                  {format(t.onboarding.art.waitMins, { mins: waits[i - 1] })}
                </ArtText>
              )}
            </View>
          ))}
        </View>
      </Card>

      <Float progress={progress} depth={1.4} style={[s.walkInPill, { backgroundColor: colors.primary }]}>
        <Icon name="plus" size={14} color={colors.textOnBrand} strokeWidth={2.6} />
        <ArtText size={12} weight="bold" color="textOnBrand">
          {t.queue.walkIn}
        </ArtText>
      </Float>
      <Float progress={progress} depth={0.8} delay={500} style={s.queueChip}>
        <Chip s={s} icon="clock" iconColor={colors.primary} iconBg={colors.primarySoft} label={format(t.onboarding.art.avgWait, { mins: 14 })} />
      </Float>
    </>
  );
}

function BookingsScene({ s, progress }: { s: ArtStyles; progress: Progress }) {
  const { colors } = useTheme();
  // The current week, Monday first, in the device's locale. A real week reads as "my calendar"
  // far better than invented dates would.
  const week = useMemo(() => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return {
        key: i,
        day: d.toLocaleDateString([], { weekday: 'narrow' }),
        date: d.getDate(),
        today: d.toDateString() === today.toDateString(),
      };
    });
  }, []);
  const appts = t.onboarding.art.appointments;

  return (
    <>
      <Card progress={progress} style={[s.card, s.bookingsCard]}>
        <View style={s.weekRow}>
          {week.map((d) => (
            <View key={d.key} style={[s.dayCell, d.today && { backgroundColor: colors.primary }]}>
              <ArtText size={9} weight="semibold" color={d.today ? 'textOnBrand' : 'textMuted'}>
                {d.day}
              </ArtText>
              <ArtText size={13} weight="bold" color={d.today ? 'textOnBrand' : 'textStrong'}>
                {d.date}
              </ArtText>
            </View>
          ))}
        </View>
        <View style={s.stack}>
          {appts.map((a, i) => (
            <View key={a.time} style={s.row}>
              <ArtText size={11} weight="bold" color="textStrong" style={s.apptTime}>
                {a.time}
              </ArtText>
              <View style={[s.apptCard, { borderLeftColor: i === 0 ? colors.primary : colors.success }]}>
                <View style={s.grow}>
                  <ArtText size={12} weight="semibold" color="textStrong">
                    {a.name}
                  </ArtText>
                  <ArtText size={10} color="textMuted">
                    {a.service}
                  </ArtText>
                </View>
                {i === 0 ? (
                  <View style={[s.pill, { backgroundColor: colors.primarySoft }]}>
                    <ArtText size={10} weight="bold" color="primarySoftFg">
                      {t.dashboard.kpiCheckIn}
                    </ArtText>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </Card>

      <Float progress={progress} depth={1.3} style={s.bookingToast}>
        <Chip s={s} icon="bell" iconColor={colors.primary} iconBg={colors.primarySoft} label={t.onboarding.art.newBooking} />
      </Float>
      <Float progress={progress} depth={0.9} delay={600} style={[s.bubble, s.bookingBubble, { backgroundColor: colors.successSoft }]}>
        <Icon name="calendar" size={22} color={colors.success} />
      </Float>
    </>
  );
}

function CustomersScene({ s, progress }: { s: ArtStyles; progress: Progress }) {
  const { colors } = useTheme();
  const art = t.onboarding.art;
  const metrics = [
    { label: t.customers.visits, value: art.visitsValue },
    { label: t.customers.lastVisit, value: art.lastVisitValue },
    { label: t.customers.spend, value: art.spendValue },
  ];
  const bars = [0.35, 0.55, 0.42, 0.7, 0.5, 0.82, 1];

  return (
    <>
      <Card progress={progress} style={[s.card, s.customerCard]}>
        <View style={s.row}>
          <View style={[s.avatarRound, { backgroundColor: colors.primarySoft }]}>
            <ArtText size={13} weight="extrabold" color="primarySoftFg">
              SK
            </ArtText>
          </View>
          <View style={s.grow}>
            <ArtText size={13} weight="bold" color="textStrong">
              {art.customerName}
            </ArtText>
            <ArtText size={10} color="textMuted">
              {art.customerPhone}
            </ArtText>
          </View>
          <View style={[s.pill, { backgroundColor: colors.primarySoft }]}>
            <ArtText size={10} weight="bold" color="primarySoftFg">
              {t.customers.vip}
            </ArtText>
          </View>
        </View>
        <View style={s.metricRow}>
          {metrics.map((m) => (
            <View key={m.label} style={s.metric}>
              <ArtText size={13} weight="extrabold" color="textStrong">
                {m.value}
              </ArtText>
              <ArtText size={9} weight="medium" color="textMuted">
                {m.label}
              </ArtText>
            </View>
          ))}
        </View>
      </Card>

      <Float progress={progress} depth={1.2} delay={300} style={[s.card, s.statsCard]}>
        <View style={s.rowBetween}>
          <ArtText size={10} weight="bold" color="textMuted">
            {art.today.toUpperCase()}
          </ArtText>
          <Icon name="trendingUp" size={14} color={colors.success} strokeWidth={2.4} />
        </View>
        <ArtText size={18} weight="extrabold" color="textStrong">
          {art.todayRevenue}
        </ArtText>
        <View style={s.bars}>
          {bars.map((h, i) => (
            <View
              key={i}
              style={[s.bar, { height: 8 + h * 34, backgroundColor: i === bars.length - 1 ? colors.primary : colors.primarySoft }]}
            />
          ))}
        </View>
      </Float>
      <Float progress={progress} depth={0.7} delay={900} style={[s.bubble, s.customerBubble, { backgroundColor: colors.warningSoft }]}>
        <Icon name="star" size={20} color={colors.amber500} />
      </Float>
    </>
  );
}

function ShareScene({ s, progress }: { s: ArtStyles; progress: Progress }) {
  const { colors } = useTheme();
  return (
    <>
      <Card progress={progress} style={[s.card, s.qrCard]}>
        <View style={s.qrFrame}>
          {/* A real code for the TejoTime site: scanning the tour does something sensible. */}
          <QRCode value={WEB_BASE_URL} size={118} color={colors.textStrong} backgroundColor={colors.surfaceCard} />
        </View>
        <ArtText size={11} weight="semibold" color="textMuted" style={s.center}>
          {t.onboarding.art.scanToBook}
        </ArtText>
      </Card>

      <Float progress={progress} depth={1.3} style={s.joinedToast}>
        <Chip s={s} icon="checkCircle" iconColor={colors.success} iconBg={colors.successSoft} label={t.onboarding.art.joinedQueue} />
      </Float>
      <Float progress={progress} depth={0.9} delay={500} style={s.linkPill}>
        <ArtText size={12} weight="semibold" color="primary">
          {t.onboarding.art.shopLink}
        </ArtText>
        <Icon name="arrowRight" size={14} color={colors.primary} strokeWidth={2.4} />
      </Float>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */

const createArtStyles = ({ colors, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    canvas: { width: ART_WIDTH, height: ART_HEIGHT },

    disc: {
      position: 'absolute',
      width: 240,
      height: 240,
      left: (ART_WIDTH - 240) / 2,
      top: (ART_HEIGHT - 240) / 2,
      borderRadius: 120,
      backgroundColor: colors.primarySoft,
      opacity: 0.85,
    },
    ring: {
      position: 'absolute',
      width: 296,
      height: 296,
      left: (ART_WIDTH - 296) / 2,
      top: (ART_HEIGHT - 296) / 2,
      borderRadius: 148,
      borderWidth: 1,
      borderColor: colors.borderDefault,
      borderStyle: 'dashed',
    },
    dot: { position: 'absolute', borderRadius: 999 },
    dotA: { width: 10, height: 10, top: 36, left: 22, backgroundColor: colors.primary },
    dotB: { width: 8, height: 8, bottom: 30, right: 36, backgroundColor: colors.success },
    dotC: { width: 7, height: 7, top: 10, right: 90, backgroundColor: colors.amber500 },

    card: {
      position: 'absolute',
      backgroundColor: colors.surfaceCard,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      padding: 14,
      ...shadow.lg,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    grow: { flex: 1, minWidth: 0 },
    stack: { gap: 7, marginTop: 12 },
    center: { textAlign: 'center', marginTop: 8 },
    pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },

    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 7,
      paddingLeft: 7,
      paddingRight: 12,
      borderRadius: 999,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      ...shadow.md,
    },
    chipIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    bubble: {
      position: 'absolute',
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadow.md,
    },

    /* queue */
    queueCard: { left: 34, top: 44, width: 252 },
    avatarSquare: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    queueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      padding: 7,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    token: { width: 34, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    walkInPill: {
      position: 'absolute',
      top: 14,
      right: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      ...shadow.md,
    },
    queueChip: { position: 'absolute', left: 6, bottom: 12 },

    /* bookings */
    bookingsCard: { left: 26, top: 66, width: 268 },
    weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
    dayCell: { width: 32, paddingVertical: 5, borderRadius: 10, alignItems: 'center', gap: 1 },
    apptTime: { width: 36 },
    apptCard: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderLeftWidth: 3,
      borderColor: colors.borderSubtle,
    },
    bookingToast: { position: 'absolute', top: 14, left: 40 },
    bookingBubble: { right: 8, bottom: 22 },

    /* customers */
    customerCard: { left: 18, top: 40, width: 244 },
    avatarRound: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    metricRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.borderSubtle,
    },
    metric: { gap: 1 },
    statsCard: { right: 10, bottom: 14, width: 158, padding: 12 },
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 42, marginTop: 6 },
    bar: { flex: 1, borderRadius: 4 },
    customerBubble: { right: 22, top: 18 },

    /* share */
    qrCard: { left: 76, top: 42, width: 168, alignItems: 'center' },
    qrFrame: { padding: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surfaceCard },
    joinedToast: { position: 'absolute', top: 10, right: 4 },
    linkPill: {
      position: 'absolute',
      left: 10,
      bottom: 22,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.surfaceCard,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      ...shadow.md,
    },
  });
