import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TSheet, TText } from '@/components/common';
import { useResponsive } from '@/hooks/useResponsive';
import { format, plural, t } from '@/i18n';
import { api } from '@/lib/api';
import {
  formatClock,
  formatDayKey,
  formatRate,
  reportQueryString,
  type CommissionVisit,
  type CommissionVisits,
  type ReportQuery,
} from '@/lib/commission';
import { segmentBreakdown } from '@/lib/commission-text';
import { formatMoney } from '@/lib/mappers';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * One stylist's visits for the Reports period, each with the rate of its own day and what it
 * earned — the app's twin of owner-web's CommissionVisitsSheet. Mounted once in (app)/_layout.tsx
 * and opened through the store (`openCommissionVisits`), like DayAppointmentsSheet.
 *
 * It reads live rather than through the store: it is one stylist's list, opened now and then.
 * The API decides whose visits come back — a staff login only ever gets its own chair.
 * Dates and times are the STORE's, from the API's `localDate` / `localTime`.
 */
export function CommissionVisitsSheet() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useAppState();
  const { centerStyle } = useResponsive(560);
  const s = useMemo(() => createStyles(theme, insets.bottom), [theme, insets.bottom]);

  const target = store.commissionVisitsFor;
  // Keep showing the last stylist while the sheet animates out (TSheet stays mounted through it).
  const [shown, setShown] = useState(target);
  if (target && target !== shown) setShown(target);

  const query: ReportQuery = {
    range: store.reportRange,
    from: store.reportFrom ?? undefined,
    to: store.reportTo ?? undefined,
  };
  const queryKey = reportQueryString(query);

  return (
    <TSheet visible={!!target} onClose={store.closeCommissionVisits} contentStyle={[s.sheet, centerStyle]}>
      <View style={s.handle} />
      {shown ? (
        <VisitsBody key={`${shown.staffId}:${queryKey}`} staffId={shown.staffId} name={shown.name} query={query} styles={s} />
      ) : null}
    </TSheet>
  );
}

function VisitsBody({
  staffId,
  name,
  query,
  styles: s,
}: {
  staffId: string;
  name: string;
  query: ReportQuery;
  styles: ReturnType<typeof createStyles>;
}) {
  const { colors } = useTheme();
  const [data, setData] = useState<CommissionVisits | null>(null);
  const [failed, setFailed] = useState(false);

  // Remounted (via key) for each stylist and period, so this runs once per opening.
  useEffect(() => {
    let alive = true;
    api
      .getCommissionVisits(staffId, query)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Newest first from the API; one heading per store day.
  const days = useMemo(() => {
    const out: [string, CommissionVisit[]][] = [];
    for (const v of data?.data ?? []) {
      const last = out[out.length - 1];
      if (last && last[0] === v.localDate) last[1].push(v);
      else out.push([v.localDate, [v]]);
    }
    return out;
  }, [data]);

  return (
    <>
      <TText variant="h4" weight="semibold" numberOfLines={2}>
        {data?.staff.name ?? name}
      </TText>
      {data ? (
        <TText variant="bodySm" color="textMuted" style={s.sub}>
          {data.periodLabel}
        </TText>
      ) : null}

      {failed ? (
        <TText variant="bodySm" color="textMuted" style={s.note}>
          {t.commission.visitsLoadError}
        </TText>
      ) : !data ? (
        <View style={s.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          <TText variant="bodyMd" color="textStrong" weight="bold" style={s.total}>
            {plural(data.totals.visits, t.commission.visitsTotalOne, t.commission.visitsTotal, {
              revenue: formatMoney(data.totals.revenue),
              commission: formatMoney(data.totals.commission),
            })}
          </TText>
          {data.segments.length ? (
            <TText variant="caption" color="textMuted" style={s.breakdown}>
              {segmentBreakdown(data.segments)}
            </TText>
          ) : null}

          {data.data.length === 0 ? (
            <TText variant="bodySm" color="textMuted" style={s.note}>
              {t.commission.visitsEmpty}
            </TText>
          ) : (
            <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
              {days.map(([day, visits]) => (
                <View key={day} style={s.day}>
                  <TText variant="caption" color="textMuted" weight="bold" style={s.dayTitle}>
                    {formatDayKey(day, { weekday: true }).toUpperCase()}
                  </TText>
                  {visits.map((v) => (
                    <View key={v.id} style={[s.row, { borderBottomColor: colors.borderSubtle }]}>
                      <TText variant="bodySm" color="textMuted" weight="semibold" style={s.time}>
                        {formatClock(v.localTime)}
                      </TText>
                      <View style={s.main}>
                        <TText variant="bodySm" color="textStrong" weight="semibold">
                          {v.serviceName || t.commission.visitNoService}
                        </TText>
                        {v.customerName ? (
                          <TText variant="caption" color="textMuted">
                            {v.customerName}
                          </TText>
                        ) : null}
                      </View>
                      <View style={s.money}>
                        <TText variant="bodySm" color="textStrong" weight="bold">
                          {formatMoney(v.amount)}
                        </TText>
                        <TText
                          variant="caption"
                          weight="semibold"
                          style={{ color: v.rateBp == null ? colors.textMuted : colors.primary }}>
                          {v.rateBp == null || !v.commission
                            ? t.stats.rateNone
                            : `${formatRate(v.rateBp)} · ${formatMoney(v.commission)}`}
                        </TText>
                      </View>
                    </View>
                  ))}
                </View>
              ))}
              {data.meta.shown < data.meta.total ? (
                <TText variant="caption" color="textMuted" style={s.note}>
                  {format(t.commission.visitsTruncated, { shown: data.meta.shown, total: data.meta.total })}
                </TText>
              ) : null}
            </ScrollView>
          )}
        </>
      )}
    </>
  );
}

const createStyles = ({ colors, radius }: ThemeStyleProps, bottomInset: number) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: moderateScale(radius.xl),
      borderTopRightRadius: moderateScale(radius.xl),
      ...styles.ph5,
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(26) + bottomInset,
      // Bottom-anchored: capped so a long list scrolls instead of pushing the title off-screen.
      maxHeight: '86%',
    },
    handle: {
      width: moderateScale(40),
      height: moderateScale(4),
      borderRadius: moderateScale(99),
      backgroundColor: colors.borderDefault,
      alignSelf: 'center',
      ...styles.mb4,
    },
    sub: { marginTop: moderateScale(2) },
    loading: { paddingVertical: moderateScale(28), ...styles.itemsCenter },
    total: { marginTop: moderateScale(12) },
    breakdown: { marginTop: moderateScale(4) },
    list: { flexGrow: 0, flexShrink: 1, marginTop: moderateScale(12) },
    day: { marginBottom: moderateScale(12) },
    dayTitle: { letterSpacing: 0.4, marginBottom: moderateScale(4) },
    row: {
      ...styles.flexRow,
      ...styles.itemsStart,
      gap: moderateScale(12),
      paddingVertical: moderateScale(10),
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    time: { width: moderateScale(64) },
    main: { ...styles.flex, ...styles.minWidth0 },
    money: { ...styles.itemsEnd },
    note: { marginTop: moderateScale(12) },
  });
