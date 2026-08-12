import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { QueueCard } from '@/components/cards/QueueCard';
import { TButton, THeader, TScopeNotice, TScreenScroll, TSectionTitle, TText } from '@/components/common';
import { format, t } from '@/i18n';
import { can } from '@/lib/permissions';
import { flatCards } from '@/lib/queue';
import { formatMoney } from '@/lib/mappers';
import { TAB_ROUTES } from '@/navigation/routes';
import { useAppState, type DashboardStaffRow, type ReportRange } from '@/state/store';
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

export default function Stats() {
  const theme = useTheme();
  const { colors } = theme;
  const s = useMemo(() => createReportStyles(theme), [theme]);
  const store = useAppState();
  const showQueue = can(store.session?.permissions ?? null, 'queue');
  const scoped = store.session?.role === 'staff';
  const showByStaff = !scoped && store.session?.role != null;
  const range = store.reportRange;
  const d = store.dashboard;
  const staffRows = useMemo(() => sortStaff(store.dashboardByStaff), [store.dashboardByStaff]);

  const queuePreview = range === 'today' ? flatCards(store.seats).slice(0, 3) : [];
  const subtitle = store.reportPeriodLabel ?? (range === 'month' ? t.stats.subtitleMonth : t.stats.subtitle);
  const rangeEyebrow = range === 'month' ? t.stats.rangeMonth : t.stats.rangeToday;
  const headerTitle = scoped ? t.stats.myReport : t.stats.storeReport;
  const revenueLabel = scoped ? t.stats.kpiYourRevenue : t.stats.kpiRevenue;
  const revenue = d ? formatMoney(d.revenue) : t.common.dash;

  const metrics = [
    {
      key: 'appts',
      label: t.stats.kpiAppts,
      value: d ? String(d.todaysAppointments) : t.common.dash,
    },
    {
      key: 'completed',
      label: t.stats.kpiCompleted,
      value: d ? String(d.completed) : t.common.dash,
    },
    ...(range === 'today'
      ? [
          {
            key: 'queue',
            label: t.stats.kpiInQueue,
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

        <View style={[s.hero, { backgroundColor: colors.surfaceCard, borderColor: colors.borderSubtle }]}>
          <View style={s.heroTop}>
            <View style={s.heroCopy}>
              <TText variant="caption" weight="bold" style={{ color: colors.primary }}>
                {rangeEyebrow.toUpperCase()}
              </TText>
              <TText variant="h4" color="textStrong" weight="extrabold" style={s.heroTitle}>
                {headerTitle}
              </TText>
              {scoped && store.session?.name ? (
                <TText variant="caption" color="textMuted" style={s.heroSub}>
                  {format(t.stats.chairOf, { name: store.session.name })}
                </TText>
              ) : null}
            </View>
            <View style={s.heroRevenue}>
              <TText variant="caption" color="textMuted" weight="bold">
                {revenueLabel.toUpperCase()}
              </TText>
              <TText variant="h3" color="textStrong" weight="extrabold" style={s.heroRevenueValue}>
                {revenue}
              </TText>
            </View>
          </View>

          <View style={s.metricRow}>
            {metrics.map((m) => (
              <View
                key={m.key}
                style={[
                  s.metric,
                  { backgroundColor: colors.surfaceHover },
                  metrics.length === 3 ? s.metricThird : s.metricHalf,
                ]}>
                <TText variant="caption" color="textMuted" weight="bold">
                  {m.label.toUpperCase()}
                </TText>
                <TText variant="h4" color="textStrong" weight="extrabold" style={s.metricValue}>
                  {m.value}
                </TText>
              </View>
            ))}
          </View>
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

            {staffRows.length === 0 ? (
              <TText variant="bodySm" color="textMuted">
                {t.stats.emptyStaff}
              </TText>
            ) : (
              <View style={s.staffList}>
                {staffRows.map((row, i) => {
                  const top = i === 0 && row.revenue.amount > 0;
                  return (
                    <View
                      key={row.staffId}
                      style={[
                        s.staffCard,
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
              {queuePreview.length === 0 ? (
                <TText variant="bodySm" color="textMuted">
                  {scoped ? t.stats.emptyYourQueue : t.dashboard.emptyQueue}
                </TText>
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

const createReportStyles = ({ colors, radius }: ThemeStyleProps) =>
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
      borderWidth: moderateScale(1),
      borderRadius: moderateScale(radius.lg),
      padding: moderateScale(16),
      marginBottom: moderateScale(18),
    },
    heroTop: {
      ...styles.flexRow,
      ...styles.justifyBetween,
      ...styles.g3,
      paddingBottom: moderateScale(14),
      marginBottom: moderateScale(12),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    heroCopy: { ...styles.flex, ...styles.minWidth0 },
    heroTitle: { marginTop: moderateScale(4), letterSpacing: -0.4 },
    heroSub: { marginTop: moderateScale(4) },
    heroRevenue: { alignItems: 'flex-end', flexShrink: 0 },
    heroRevenueValue: { marginTop: moderateScale(4), letterSpacing: -0.6 },
    metricRow: { ...styles.flexRow, ...styles.g2, ...styles.wrap },
    metric: {
      borderRadius: moderateScale(10),
      paddingVertical: moderateScale(10),
      paddingHorizontal: moderateScale(12),
    },
    metricHalf: { width: '48%', flexGrow: 1 },
    metricThird: { width: '31%', flexGrow: 1 },
    metricValue: { marginTop: moderateScale(6), letterSpacing: -0.4 },
    lead: { marginTop: moderateScale(-8), marginBottom: moderateScale(12), lineHeight: moderateScale(18) },
    staffList: { ...styles.g2, marginBottom: moderateScale(8) },
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
    staffStats: { ...styles.flexRow, ...styles.justifyBetween, ...styles.g2 },
    staffStat: { ...styles.itemsCenter, ...styles.flex, ...styles.g1 },
    queueList: { ...styles.g2 },
  });
