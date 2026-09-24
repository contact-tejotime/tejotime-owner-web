import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { QueueCard } from '@/components/cards/QueueCard';
import {
  TButton,
  TEmptyState,
  THeader,
  TQueueRowSkeleton,
  TScopeNotice,
  TScreenScroll,
  TSectionTitle,
  TSkeleton,
  TText,
} from '@/components/common';
import { useTabContent } from '@/hooks/useResponsive';
import { format, t } from '@/i18n';
import { Icon, type IconName } from '@/components/ui/Icon';
import { can } from '@/lib/permissions';
import { flatCards } from '@/lib/queue';
import { formatMoney } from '@/lib/mappers';
import { TAB_ROUTES } from '@/navigation/routes';
import { useAppState, type DashboardStaffRow, type ReportRange } from '@/state/store';
import { withAlpha } from '@/theme/ink';
import { useTheme } from '@/theme/ThemeProvider';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

function sortStaff(rows: DashboardStaffRow[]): DashboardStaffRow[] {
  return [...rows].sort(
    (a, b) =>
      b.revenue.amount - a.revenue.amount ||
      b.completed - a.completed ||
      a.name.localeCompare(b.name),
  );
}

/** A staff card holds a name plus three labelled figures side by side. */
const STAFF_CARD_MIN_WIDTH = 300;

export default function Stats() {
  const theme = useTheme();
  const { colors } = theme;
  const { columns, gridItemWidth } = useTabContent();
  const staffColumns = columns(STAFF_CARD_MIN_WIDTH, { gutter: 8, max: 2 });
  const s = useMemo(() => createReportStyles(theme), [theme]);
  const store = useAppState();
  const showQueue = can(store.session?.permissions ?? null, 'queue');
  const scoped = store.session?.role === 'staff';
  const showByStaff = !scoped && store.session?.role != null;
  const range = store.reportRange;
  const d = store.dashboard;
  /** First load: pulse where the figures and rows will be, rather than "—" and "No staff yet". */
  const loading = store.bootstrapping;
  const staffRows = useMemo(() => sortStaff(store.dashboardByStaff), [store.dashboardByStaff]);

  const queuePreview = range === 'today' ? flatCards(store.seats).slice(0, 3) : [];
  const subtitle = store.reportPeriodLabel ?? (range === 'month' ? t.stats.subtitleMonth : t.stats.subtitle);
  const rangeEyebrow = range === 'month' ? t.stats.rangeMonth : t.stats.rangeToday;
  const headerTitle = scoped ? t.stats.myReport : t.stats.storeReport;
  const revenueLabel = scoped ? t.stats.kpiYourRevenue : t.stats.kpiRevenue;
  const revenue = d ? formatMoney(d.revenue) : t.common.dash;
  const ink = colors.textOnBrand;
  // Average ticket: the one number a day's revenue can't tell on its own. Derived here from two
  // figures the API already returns, so it can never disagree with them.
  const revenueNote = !d
    ? null
    : d.completed > 0
      ? format(t.stats.avgPerVisit, {
          avg: formatMoney({ ...d.revenue, amount: Math.round(d.revenue.amount / d.completed) }),
        })
      : t.stats.noVisitsYet;
  const totalStaffRevenue = staffRows.reduce((n, r) => n + r.revenue.amount, 0);

  // Labels are sentence case and held to one line. Uppercase caption labels in three tiles
  // across a phone broke mid-word ("APPOINT / MENTS", "COMPLET / ED"): a single word wider
  // than its tile wraps at a letter, because there is no space to wrap at.
  const metrics: { key: string; icon: IconName; label: string; value: string }[] = [
    {
      key: 'appts',
      icon: 'calendar',
      label: t.stats.kpiAppts,
      value: d ? String(d.todaysAppointments) : t.common.dash,
    },
    {
      key: 'completed',
      icon: 'checkCircle',
      label: t.stats.kpiCompleted,
      value: d ? String(d.completed) : t.common.dash,
    },
    ...(range === 'today'
      ? [
          {
            key: 'queue',
            icon: 'users' as IconName,
            label: t.stats.kpiInQueueShort,
            value: d ? String(d.activeNow + d.waitingNow) : t.common.dash,
          },
        ]
      : []),
  ];

  const setRange = (next: ReportRange) => {
    if (next !== range) store.setReportRange(next);
  };

  return (
    <>
      <THeader title={t.stats.title} subtitle={subtitle} />
      <TScreenScroll refreshing={store.refreshing} onRefresh={store.refresh}>
        <TScopeNotice />

        <View style={s.segmented} accessibilityRole="tablist">
          {(['today', 'month'] as const).map((key) => {
            const active = range === key;
            return (
              <Pressable
                key={key}
                onPress={() => setRange(key)}
                style={[s.segmentedBtn, active && { backgroundColor: colors.surfaceCard }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}>
                <TText variant="bodySm" weight="bold" color={active ? 'textStrong' : 'textMuted'}>
                  {key === 'today' ? t.stats.rangeToday : t.stats.rangeMonth}
                </TText>
              </Pressable>
            );
          })}
        </View>

        {/* Revenue leads, on the store's brand colour like Home's live-queue card: it is the figure
            an owner opens Reports for. Everything on it takes the brand's ink, never a fixed white,
            because in dark mode the brand turns light and its ink turns dark. */}
        <View style={s.hero}>
          <View style={[s.disc, s.discA]} pointerEvents="none" />
          <View style={[s.disc, s.discB]} pointerEvents="none" />
          <TText variant="caption" weight="bold" style={[s.heroEyebrow, { color: withAlpha(ink, 0.9) }]}>
            {`${rangeEyebrow} · ${headerTitle}`.toUpperCase()}
          </TText>
          {scoped && store.session?.name ? (
            <TText variant="caption" weight="semibold" style={[s.heroSub, { color: withAlpha(ink, 0.85) }]}>
              {format(t.stats.chairOf, { name: store.session.name })}
            </TText>
          ) : null}
          <TText variant="bodySm" weight="semibold" style={[s.heroLabel, { color: withAlpha(ink, 0.85) }]}>
            {revenueLabel}
          </TText>
          {loading && !d ? (
            <View style={[s.heroSkeleton, { backgroundColor: withAlpha(ink, 0.22) }]} />
          ) : (
            <TText
              variant="h1"
              weight="extrabold"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              style={[s.heroRevenue, { color: ink }]}>
              {revenue}
            </TText>
          )}
          {revenueNote ? (
            <TText variant="bodySm" weight="semibold" style={{ color: withAlpha(ink, 0.9) }}>
              {revenueNote}
            </TText>
          ) : null}
        </View>

        <View style={s.metricRow}>
          {metrics.map((m) => (
            <View
              key={m.key}
              style={[s.metric, { backgroundColor: colors.surfaceCard, borderColor: colors.borderSubtle }]}
              accessible
              accessibilityLabel={`${m.label}: ${m.value}`}>
              <View style={[s.metricIcon, { backgroundColor: colors.primarySoft }]}>
                <Icon name={m.icon} size={16} color={colors.primarySoftFg} />
              </View>
              {loading && !d ? (
                <TSkeleton width={moderateScale(32)} height={22} style={s.metricValue} />
              ) : (
                <TText
                  variant="h3"
                  color="textStrong"
                  weight="extrabold"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  style={s.metricValue}>
                  {m.value}
                </TText>
              )}
              <TText
                variant="caption"
                color="textMuted"
                weight="semibold"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}>
                {m.label}
              </TText>
            </View>
          ))}
        </View>

        {showByStaff ? (
          <>
            <TSectionTitle
              action={
                <TText variant="caption" color="textMuted" weight="semibold">
                  {staffRows.length === 1
                    ? t.stats.seatOne
                    : format(t.stats.seatsCount, { n: staffRows.length })}
                </TText>
              }>
              {t.stats.byStaff}
            </TSectionTitle>
            <TText variant="bodySm" color="textMuted" style={s.lead}>
              {range === 'month' ? t.stats.byStaffLeadMonth : t.stats.byStaffLeadToday}
            </TText>

            {loading && staffRows.length === 0 ? (
              <View style={s.staffList}>
                <TQueueRowSkeleton />
                <TQueueRowSkeleton />
              </View>
            ) : staffRows.length === 0 ? (
              <TEmptyState compact icon="users" title={t.stats.emptyStaff} />
            ) : (
              <View style={staffColumns > 1 ? s.staffGrid : s.staffList}>
                {staffRows.map((row, i) => {
                  const top = i === 0 && row.revenue.amount > 0;
                  const share =
                    totalStaffRevenue > 0 ? Math.round((row.revenue.amount / totalStaffRevenue) * 100) : null;
                  return (
                    <View
                      key={row.staffId}
                      style={[
                        s.staffCard,
                        staffColumns > 1 && { width: gridItemWidth(staffColumns) },
                        {
                          backgroundColor: top ? colors.primarySoft : colors.surfaceCard,
                          borderColor: top ? colors.primary : colors.borderSubtle,
                        },
                      ]}>
                      <View style={s.staffIdentity}>
                        <View style={[s.avatar, { backgroundColor: top ? colors.surfaceCard : colors.primarySoft }]}>
                          <TText
                            variant="caption"
                            weight="extrabold"
                            style={{ color: colors.primarySoftFg }}>
                            {initials(row.name)}
                          </TText>
                        </View>
                        <TText variant="bodyMd" weight="bold" color="textStrong" style={s.staffName}>
                          {row.name}
                        </TText>
                      </View>

                      {/* Share of the shop's takings: who carried the day, readable without
                          comparing figures card to card. Hidden on a day with no revenue, where
                          every bar would be empty. */}
                      {share !== null ? (
                        <View style={s.shareRow}>
                          <View
                            style={[s.shareTrack, { backgroundColor: top ? colors.surfaceCard : colors.surfaceHover }]}>
                            <View style={[s.shareFill, { width: `${share}%`, backgroundColor: colors.primary }]} />
                          </View>
                          <TText variant="caption" color="textMuted" weight="semibold">
                            {format(t.stats.shareOfRevenue, { pct: share })}
                          </TText>
                        </View>
                      ) : null}

                      <View style={s.staffStats}>
                        <View style={s.staffStat}>
                          <TText variant="caption" color="textMuted" weight="semibold">
                            {t.stats.colAppts}
                          </TText>
                          <TText variant="bodyMd" color="textStrong" weight="extrabold">
                            {row.appointments}
                          </TText>
                        </View>
                        <View style={s.staffStat}>
                          <TText variant="caption" color="textMuted" weight="semibold">
                            {t.stats.colDone}
                          </TText>
                          <TText variant="bodyMd" color="textStrong" weight="extrabold">
                            {row.completed}
                          </TText>
                        </View>
                        <View style={s.staffStat}>
                          <TText variant="caption" color="textMuted" weight="semibold">
                            {t.stats.colRevenue}
                          </TText>
                          <TText variant="bodyMd" weight="extrabold" style={{ color: colors.primary }}>
                            {formatMoney(row.revenue)}
                          </TText>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        ) : null}

        {showQueue && range === 'today' ? (
          <>
            <TSectionTitle
              action={
                <TButton
                  variant="ghost"
                  size="sm"
                  onPress={() => router.push(TAB_ROUTES.dashboard as any)}
                  textColor={colors.primary}>
                  {t.dashboard.viewAll}
                </TButton>
              }>
              {scoped ? t.stats.yourQueue : t.dashboard.activeQueue}
            </TSectionTitle>
            <View style={s.queueList}>
              {loading && queuePreview.length === 0 ? (
                <>
                  <TQueueRowSkeleton />
                  <TQueueRowSkeleton />
                </>
              ) : queuePreview.length === 0 ? (
                <TEmptyState compact icon="clock" title={scoped ? t.stats.emptyYourQueue : t.dashboard.emptyQueue} />
              ) : (
                queuePreview.map((c) => <QueueCard key={c.id} card={c} onPress={() => store.openDetail(c.id)} />)
              )}
            </View>
          </>
        ) : null}
      </TScreenScroll>
    </>
  );
}

const createReportStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    segmented: {
      ...styles.flexRow,
      backgroundColor: colors.surfaceHover,
      borderRadius: moderateScale(10),
      padding: moderateScale(4),
      gap: moderateScale(4),
      marginBottom: moderateScale(14),
    },
    segmentedBtn: {
      ...styles.flex,
      ...styles.itemsCenter,
      ...styles.justifyCenter,
      height: moderateScale(36),
      borderRadius: moderateScale(7),
    },
    hero: {
      backgroundColor: colors.primary,
      borderRadius: moderateScale(radius.xl),
      paddingHorizontal: moderateScale(18),
      paddingVertical: moderateScale(16),
      marginBottom: moderateScale(10),
      overflow: 'hidden',
      ...shadow.md,
    },
    // Same two ink discs as Home's live-queue card, so the two filled cards read as one family.
    disc: { position: 'absolute', borderRadius: 999, backgroundColor: withAlpha(colors.textOnBrand, 0.08) },
    discA: { width: moderateScale(180), height: moderateScale(180), top: moderateScale(-70), right: moderateScale(-50) },
    discB: { width: moderateScale(120), height: moderateScale(120), bottom: moderateScale(-60), left: moderateScale(-30) },
    heroEyebrow: { letterSpacing: 1.2 },
    heroSub: { marginTop: moderateScale(2) },
    heroLabel: { marginTop: moderateScale(14) },
    heroRevenue: { marginTop: moderateScale(2), marginBottom: moderateScale(4), letterSpacing: -1 },
    heroSkeleton: {
      width: moderateScale(120),
      height: moderateScale(40),
      marginTop: moderateScale(4),
      marginBottom: moderateScale(8),
      borderRadius: moderateScale(10),
    },
    // `flex: 1` tiles with a fixed gap, not percent widths: nothing here wraps, so the
    // percent-plus-gap overflow the staff grid guards against can't happen.
    metricRow: { ...styles.flexRow, gap: moderateScale(8), marginBottom: moderateScale(18) },
    metric: {
      ...styles.flex,
      ...styles.minWidth0,
      borderWidth: moderateScale(1),
      borderRadius: moderateScale(radius.lg),
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(12),
    },
    metricIcon: {
      width: moderateScale(30),
      height: moderateScale(30),
      borderRadius: moderateScale(9),
      ...styles.itemsCenter,
      ...styles.justifyCenter,
    },
    metricValue: { marginTop: moderateScale(10), letterSpacing: -0.6 },
    lead: { marginTop: moderateScale(-8), marginBottom: moderateScale(12), lineHeight: moderateScale(18) },
    staffList: { ...styles.g2, marginBottom: moderateScale(8) },
    // `rowGap` only, never `gap`: the cards are sized in percent, and an
    // absolute column gap on top of that overflows the row and collapses the
    // grid back to one column. `space-between` supplies the horizontal spacing.
    staffGrid: {
      ...styles.flexRow,
      ...styles.wrap,
      ...styles.justifyBetween,
      rowGap: moderateScale(8),
      marginBottom: moderateScale(8),
    },
    staffCard: {
      borderWidth: moderateScale(1),
      borderRadius: moderateScale(12),
      padding: moderateScale(14),
      ...styles.g3,
    },
    staffIdentity: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g3 },
    avatar: {
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(10),
      ...styles.itemsCenter,
      ...styles.justifyCenter,
    },
    staffName: { ...styles.flex, ...styles.minWidth0 },
    shareRow: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(10) },
    shareTrack: { ...styles.flex, height: moderateScale(6), borderRadius: moderateScale(3), overflow: 'hidden' },
    shareFill: { height: '100%', borderRadius: moderateScale(3) },
    staffStats: { ...styles.flexRow, ...styles.justifyBetween, ...styles.g2 },
    staffStat: { ...styles.itemsCenter, ...styles.flex, ...styles.g1 },
    queueList: { ...styles.g2 },
  });
