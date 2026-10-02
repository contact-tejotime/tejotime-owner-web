import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
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
import { DateRangeSheet } from '@/components/feedback/DateRangeSheet';
import { useTabContent } from '@/hooks/useResponsive';
import { format, plural, t } from '@/i18n';
import { Icon, type IconName } from '@/components/ui/Icon';
import { formatDayRange, formatRate, formatWhen, type CommissionStaffRow } from '@/lib/commission';
import { segmentBreakdown } from '@/lib/commission-text';
import { dayKeyOf } from '@/lib/date-grid';
import { can } from '@/lib/permissions';
import { flatCards } from '@/lib/queue';
import { formatMoney } from '@/lib/mappers';
import { SETTINGS_ROUTES, TAB_ROUTES } from '@/navigation/routes';
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

const RANGES: ReportRange[] = ['today', 'week', 'month', 'custom'];
const RANGE_LABELS: Record<ReportRange, string> = {
  today: t.stats.rangeToday,
  week: t.stats.rangeWeek,
  month: t.stats.rangeMonth,
  custom: t.stats.rangeCustom,
};
const RANGE_EYEBROWS: Record<ReportRange, string> = {
  today: t.stats.rangeToday,
  week: t.stats.rangeWeek,
  month: t.stats.rangeMonth,
  custom: t.stats.customRange,
};
const STAFF_LEADS: Record<ReportRange, string> = {
  today: t.stats.byStaffLeadToday,
  week: t.stats.byStaffLeadWeek,
  month: t.stats.byStaffLeadMonth,
  custom: t.stats.byStaffLeadCustom,
};

/**
 * Reports — owner-web's /stats on the phone, in the same order: the period switch (Today / This
 * week / This month / Custom), the revenue card, the metric tiles, commission (owners), the staff
 * breakdown (store-wide roles only), a stylist's own earnings (every staff login),
 * then the queue preview on Today.
 *
 * Commission is every visit at the rate of its own day (docs/staff-commission.md): each card's
 * breakdown line reads the period rate by rate, so a change on the 16th visibly paid the first
 * fortnight at the old rate. Tapping a card opens that stylist's visits.
 */
export default function Stats() {
  const theme = useTheme();
  const { colors } = theme;
  const { columns, gridItemWidth } = useTabContent();
  const staffColumns = columns(STAFF_CARD_MIN_WIDTH, { gutter: 8, max: 2 });
  const s = useMemo(() => createReportStyles(theme), [theme]);
  const store = useAppState();
  const access = store.session?.permissions ?? null;
  const showDashboard = can(access, 'dashboard');
  const showCommission = can(access, 'commission');
  const canSetRates = can(access, 'commission', 'manage');
  const showQueue = can(access, 'queue');
  const scoped = store.session?.role === 'staff';
  const showByStaff = showDashboard && !scoped && store.session?.role != null;
  const range = store.reportRange;
  const d = store.dashboard;
  /** First load: pulse where the figures and rows will be, rather than "—" and "No staff yet". */
  const loading = store.bootstrapping;
  const staffRows = useMemo(() => sortStaff(store.dashboardByStaff), [store.dashboardByStaff]);
  const [datesOpen, setDatesOpen] = useState(false);

  // The store's today, from the API — the app never learns the store's timezone. The device's own
  // date only until the first report has loaded (the API checks every date regardless).
  const todayKey = store.reportToday ?? dayKeyOf(new Date());

  const queuePreview = range === 'today' ? flatCards(store.seats).slice(0, 3) : [];
  const subtitle = store.reportPeriodLabel ?? (range === 'month' ? t.stats.subtitleMonth : t.stats.subtitle);
  const rangeEyebrow = RANGE_EYEBROWS[range];
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

  // Commission, owner's view: the store's totals, and each stylist's line for the breakdown cards.
  const commission = store.commission;
  const storeCommission = commission?.scope === 'store' && commission.staff.length > 0 ? commission : null;
  const commissionByStaff = useMemo(
    () => new Map((storeCommission?.staff ?? []).map((row) => [row.staffId, row] as [string, CommissionStaffRow])),
    [storeCommission],
  );
  const unrated = storeCommission?.staff.reduce((n, row) => n + row.unratedVisits, 0) ?? 0;
  const noRatesAnywhere =
    !!storeCommission && storeCommission.staff.every((row) => row.currentRateBp == null && row.nextRate == null);
  const commissionNotes = storeCommission
    ? [
        noRatesAnywhere ? t.stats.commissionNoRates : null,
        !noRatesAnywhere && unrated > 0
          ? plural(unrated, t.stats.commissionUnratedOne, t.stats.commissionUnrated)
          : null,
        storeCommission.unassigned && storeCommission.unassigned.visits > 0
          ? format(t.stats.commissionUnassigned, { revenue: formatMoney(storeCommission.unassigned.revenue) })
          : null,
      ].filter((n): n is string => !!n)
    : [];
  // A stylist's own view (a staff login the owner has shown its earnings to).
  const own = commission?.scope === 'self' ? (commission.staff[0] ?? null) : null;

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
    // Custom asks for its dates first; the period only changes once they are applied.
    if (next === 'custom') {
      setDatesOpen(true);
      return;
    }
    if (next !== range) store.setReportQuery({ range: next });
  };

  const renderTile = (m: { key: string; icon: IconName; label: string; value: string }, pending: boolean) => (
    <View
      key={m.key}
      style={[s.metric, { backgroundColor: colors.surfaceCard, borderColor: colors.borderSubtle }]}
      accessible
      accessibilityLabel={`${m.label}: ${m.value}`}>
      <View style={[s.metricIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon name={m.icon} size={16} color={colors.primarySoftFg} />
      </View>
      {pending ? (
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
  );

  return (
    <>
      <THeader title={t.stats.title} subtitle={subtitle} />
      <TScreenScroll refreshing={store.refreshing} onRefresh={store.refresh}>
        <TScopeNotice />

        <View style={s.segmented} accessibilityRole="tablist">
          {RANGES.map((key) => {
            const active = range === key;
            return (
              <Pressable
                key={key}
                onPress={() => setRange(key)}
                style={[s.segmentedBtn, active && { backgroundColor: colors.surfaceCard }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}>
                {/* Four periods share a phone's row: shrink rather than wrap or clip. */}
                <TText
                  variant="bodySm"
                  weight="bold"
                  color={active ? 'textStrong' : 'textMuted'}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}>
                  {RANGE_LABELS[key]}
                </TText>
              </Pressable>
            );
          })}
        </View>

        {range === 'custom' && store.reportFrom && store.reportTo ? (
          <Pressable
            onPress={() => setDatesOpen(true)}
            style={[s.customChip, { borderColor: colors.borderSubtle, backgroundColor: colors.surfaceCard }]}
            accessibilityRole="button"
            accessibilityLabel={`${formatDayRange(store.reportFrom, store.reportTo)} — ${t.stats.pickDates}`}>
            <Icon name="calendar" size={16} color={colors.textMuted} />
            <TText variant="bodySm" color="textStrong" weight="semibold" style={styles.flex}>
              {formatDayRange(store.reportFrom, store.reportTo)}
            </TText>
            <TText variant="bodySm" weight="semibold" style={{ color: colors.primary }}>
              {t.stats.pickDates}
            </TText>
          </Pressable>
        ) : null}

        {showDashboard ? (
          <>
            {/* Revenue leads, on the store's brand colour like Home's live-queue card: it is the
                figure an owner opens Reports for. Everything on it takes the brand's ink, never a
                fixed white, because in dark mode the brand turns light and its ink turns dark. */}
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

            <View style={s.metricRow}>{metrics.map((m) => renderTile(m, loading && !d))}</View>
          </>
        ) : null}

        {storeCommission ? (
          <>
            <TSectionTitle
              action={
                canSetRates ? (
                  <TButton
                    variant="ghost"
                    size="sm"
                    onPress={() => router.push(SETTINGS_ROUTES.commission as any)}
                    textColor={colors.primary}>
                    {t.stats.commissionSetRates}
                  </TButton>
                ) : undefined
              }>
              {t.stats.commissionTitle}
            </TSectionTitle>
            <TText variant="bodySm" color="textMuted" style={s.lead}>
              {t.stats.commissionLead}
            </TText>
            <View style={[s.metricRow, commissionNotes.length > 0 && s.metricRowTight]}>
              {renderTile(
                { key: 'commission', icon: 'percent', label: t.stats.commissionTotal, value: formatMoney(storeCommission.totals.commission) },
                false,
              )}
              {renderTile(
                {
                  key: 'keeps',
                  icon: 'wallet',
                  label: t.stats.salonKeeps,
                  value: storeCommission.totals.salonKeeps ? formatMoney(storeCommission.totals.salonKeeps) : t.common.dash,
                },
                false,
              )}
            </View>
            {commissionNotes.map((note) => (
              <TText key={note} variant="caption" color="textMuted" style={s.note}>
                {note}
              </TText>
            ))}
          </>
        ) : null}

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
              {STAFF_LEADS[range]}
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
                  const earned = commissionByStaff.get(row.staffId);
                  return (
                    // With commission in view the card opens that stylist's visits, each at its day's rate.
                    <Pressable
                      key={row.staffId}
                      disabled={!earned}
                      onPress={() => store.openCommissionVisits(row.staffId, row.name)}
                      accessibilityRole={earned ? 'button' : undefined}
                      accessibilityHint={earned ? t.stats.viewVisits : undefined}
                      style={({ pressed }) => [
                        s.staffCard,
                        staffColumns > 1 && { width: gridItemWidth(staffColumns) },
                        {
                          backgroundColor: top ? colors.primarySoft : colors.surfaceCard,
                          borderColor: top ? colors.primary : colors.borderSubtle,
                        },
                        pressed && earned && s.pressed,
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
                        {row.isActive === false ? (
                          <View style={[s.pill, { backgroundColor: colors.surfaceHover }]}>
                            <TText variant="caption" color="textMuted" weight="bold">
                              {t.stats.removedTag}
                            </TText>
                          </View>
                        ) : null}
                        {earned ? (
                          <View
                            style={[
                              s.pill,
                              {
                                backgroundColor:
                                  earned.currentRateBp == null
                                    ? colors.surfaceHover
                                    : top
                                      ? colors.surfaceCard
                                      : colors.primarySoft,
                              },
                            ]}>
                            <TText
                              variant="caption"
                              weight="bold"
                              style={{ color: earned.currentRateBp == null ? colors.textMuted : colors.primarySoftFg }}>
                              {earned.currentRateBp == null ? t.stats.rateNone : formatRate(earned.currentRateBp)}
                            </TText>
                          </View>
                        ) : null}
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

                      {earned ? (
                        <View style={[s.comm, { borderTopColor: colors.borderSubtle }]}>
                          <View style={s.commRow}>
                            <TText variant="caption" color="textMuted" weight="semibold">
                              {t.stats.colCommission}
                            </TText>
                            <TText variant="bodyMd" color="textStrong" weight="extrabold">
                              {formatMoney(earned.commission)}
                            </TText>
                          </View>
                          {earned.segments.length ? (
                            <TText variant="caption" color="textMuted">
                              {segmentBreakdown(earned.segments)}
                            </TText>
                          ) : null}
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        ) : null}

        {scoped && showCommission ? (
          <>
            <TSectionTitle
              action={
                own && store.session?.staffId ? (
                  <TButton
                    variant="ghost"
                    size="sm"
                    onPress={() => store.openCommissionVisits(store.session!.staffId!, own.name)}
                    textColor={colors.primary}>
                    {t.stats.viewVisits}
                  </TButton>
                ) : undefined
              }>
              {t.stats.myEarnings}
            </TSectionTitle>
            <TText variant="bodySm" color="textMuted" style={s.lead}>
              {t.stats.myEarningsLead}
            </TText>
            {own ? (
              <View style={[s.earn, { backgroundColor: colors.surfaceCard, borderColor: colors.borderSubtle }]}>
                <TText
                  variant="h2"
                  color="textStrong"
                  weight="extrabold"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}>
                  {formatMoney(own.commission)}
                </TText>
                <TText variant="caption" color="textMuted" weight="semibold">
                  {t.stats.earned}
                </TText>
                <TText variant="bodySm" color="textBody" weight="semibold" style={s.earnRate}>
                  {own.currentRateBp != null && own.currentRateFrom
                    ? format(t.stats.yourRate, {
                        rate: formatRate(own.currentRateBp),
                        day: formatWhen(own.currentRateFrom, { year: true }),
                      })
                    : t.stats.yourRateNone}
                </TText>
                {own.segments.length ? (
                  <TText variant="caption" color="textMuted" style={s.earnBreak}>
                    {segmentBreakdown(own.segments)}
                  </TText>
                ) : null}
              </View>
            ) : (
              <TEmptyState compact icon="percent" title={t.stats.yourRateNone} />
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

      <DateRangeSheet
        visible={datesOpen}
        onClose={() => setDatesOpen(false)}
        todayKey={todayKey}
        initial={{ from: store.reportFrom ?? todayKey, to: store.reportTo ?? todayKey }}
        onApply={(from, to) => {
          setDatesOpen(false);
          store.setReportQuery({ range: 'custom', from, to });
        }}
      />
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
      paddingHorizontal: moderateScale(4),
    },
    customChip: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(8),
      marginTop: moderateScale(-4),
      marginBottom: moderateScale(14),
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(10),
      borderWidth: moderateScale(1),
      borderRadius: moderateScale(10),
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
    metricRowTight: { marginBottom: moderateScale(8) },
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
    note: { marginBottom: moderateScale(4) },
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
    pressed: { opacity: 0.88 },
    staffIdentity: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g3 },
    avatar: {
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(10),
      ...styles.itemsCenter,
      ...styles.justifyCenter,
    },
    staffName: { ...styles.flex, ...styles.minWidth0 },
    pill: {
      paddingHorizontal: moderateScale(8),
      paddingVertical: moderateScale(2),
      borderRadius: moderateScale(999),
    },
    shareRow: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(10) },
    shareTrack: { ...styles.flex, height: moderateScale(6), borderRadius: moderateScale(3), overflow: 'hidden' },
    shareFill: { height: '100%', borderRadius: moderateScale(3) },
    staffStats: { ...styles.flexRow, ...styles.justifyBetween, ...styles.g2 },
    staffStat: { ...styles.itemsCenter, ...styles.flex, ...styles.g1 },
    // The card's commission line, then the period rate by rate.
    comm: { borderTopWidth: moderateScale(1), paddingTop: moderateScale(10), gap: moderateScale(4) },
    commRow: { ...styles.flexRow, ...styles.itemsCenter, ...styles.justifyBetween },
    earn: {
      borderWidth: moderateScale(1),
      borderRadius: moderateScale(12),
      padding: moderateScale(14),
      marginBottom: moderateScale(8),
    },
    earnRate: { marginTop: moderateScale(10) },
    earnBreak: { marginTop: moderateScale(4) },
    queueList: { ...styles.g2 },
  });
