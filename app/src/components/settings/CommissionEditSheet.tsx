import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TButton, TInput, TText } from '@/components/common';
import { TMonthGrid } from '@/components/common/TMonthGrid';
import { EditSheet } from '@/components/settings/EditSheet';
import { Icon } from '@/components/ui/Icon';
import { format, t } from '@/i18n';
import {
  formatDayKey,
  formatDayRange,
  formatRate,
  parseRateInput,
  rateInputValue,
  shiftDayKey,
  type CommissionRateItem,
  type CommissionStaffRates,
} from '@/lib/commission';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * One stylist's commission: the rate in force, a new rate and the day it starts, what is
 * scheduled, and what was — the app's twin of owner-web's CommissionEditor sheet.
 *
 * "Starts on" is an INLINE month grid, and Remove is an inline two-step confirm: this is already a
 * modal, and iOS will not present a second one over it (a date picker or ConfirmSheet opened from
 * here would never appear). The start day defaults to the store's today (from the API) and cannot
 * be earlier — days that are over keep the rate they were paid at; the API refuses them too.
 */
export function CommissionEditSheet({
  open,
  staff,
  today,
  busy,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  staff: CommissionStaffRates | null;
  today: string;
  busy: boolean;
  onClose: () => void;
  onSave: (rateBp: number, effectiveFrom: string) => void;
  onRemove: (effectiveFrom: string) => void;
}) {
  return (
    <EditSheet
      visible={open}
      title={staff ? format(t.commission.editTitle, { name: staff.name }) : t.commission.title}
      onClose={onClose}>
      {open && staff ? (
        <RateForm key={staff.staffId} staff={staff} today={today} busy={busy} onSave={onSave} onRemove={onRemove} />
      ) : null}
    </EditSheet>
  );
}

/** Remounted per stylist (via key) so its fields seed from props without effects. */
function RateForm({
  staff,
  today,
  busy,
  onSave,
  onRemove,
}: {
  staff: CommissionStaffRates;
  today: string;
  busy: boolean;
  onSave: (rateBp: number, effectiveFrom: string) => void;
  onRemove: (effectiveFrom: string) => void;
}) {
  const theme = useTheme();
  const { colors } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const [rate, setRate] = useState(staff.current ? rateInputValue(staff.current.rateBp) : '');
  const [from, setFrom] = useState(today);
  const [rateError, setRateError] = useState('');
  // The rate waiting for its second tap on "Yes, remove".
  const [confirming, setConfirming] = useState<string | null>(null);
  const tomorrow = shiftDayKey(today, 1);
  const latest = shiftDayKey(today, 365);

  const save = () => {
    const bp = parseRateInput(rate);
    if (bp == null) {
      setRateError(t.commission.rateInvalid);
      return;
    }
    onSave(bp, from);
  };

  const removable: CommissionRateItem[] = [
    ...(staff.current?.editable ? [staff.current] : []),
    ...staff.upcoming,
  ];

  const chip = (label: string, day: string) => {
    const active = from === day;
    return (
      <Pressable
        key={day}
        onPress={() => setFrom(day)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={[
          s.chip,
          { borderColor: active ? colors.primary : colors.borderDefault, backgroundColor: active ? colors.primary : colors.surfaceCard },
        ]}>
        <TText variant="caption" weight="semibold" style={{ color: active ? colors.textOnBrand : colors.textMuted }}>
          {label}
        </TText>
      </Pressable>
    );
  };

  return (
    <View style={styles.g4}>
      <View style={[s.current, { backgroundColor: colors.surfaceHover }]}>
        <TText variant="caption" color="textMuted" weight="semibold">
          {t.commission.current}
        </TText>
        <TText variant="bodyMd" color="textStrong" weight="bold" style={s.currentValue}>
          {staff.current
            ? format(t.commission.since, {
                rate: formatRate(staff.current.rateBp),
                day: formatDayKey(staff.current.from, { year: true }),
              })
            : t.commission.noRate}
        </TText>
      </View>

      <TInput
        label={t.commission.rateLabel}
        hint={rateError ? undefined : t.commission.rateHint}
        error={rateError || undefined}
        value={rate}
        onChangeText={(v) => {
          setRate(v);
          setRateError('');
        }}
        keyboardType="decimal-pad"
        placeholder="20"
        maxLength={6}
      />

      <View style={styles.g2}>
        <TText variant="bodySm" color="textStrong" weight="semibold">
          {t.commission.startsLabel}
        </TText>
        <View style={s.chips}>
          {chip(t.commission.startsToday, today)}
          {chip(t.commission.startsTomorrow, tomorrow)}
        </View>
        <TMonthGrid
          mode="single"
          value={{ from, to: from }}
          onChange={(next) => next.from && setFrom(next.from)}
          todayKey={today}
          minKey={today}
          maxKey={latest}
        />
        <TText variant="caption" color="textMuted">
          {format(t.commission.startsHint, { day: formatDayKey(from, { weekday: true, year: true }) })}
        </TText>
      </View>

      <TButton variant="primary" size="lg" fullWidth loading={busy} onPress={save}>
        {t.commission.save}
      </TButton>

      {removable.length ? (
        <View style={styles.g2}>
          <TText variant="caption" color="textMuted" weight="bold" style={s.listTitle}>
            {t.commission.scheduledTitle.toUpperCase()}
          </TText>
          <View style={[s.list, { borderColor: colors.borderSubtle }]}>
            {removable.map((r, i) => (
              <View
                key={r.from}
                style={[s.listRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle }]}>
                <TText variant="bodySm" color="textBody" style={styles.flex}>
                  {format(t.commission.from, { rate: formatRate(r.rateBp), day: formatDayKey(r.from, { year: true }) })}
                </TText>
                {confirming === r.from ? (
                  <View style={s.confirm}>
                    <Pressable onPress={() => onRemove(r.from)} disabled={busy} accessibilityRole="button">
                      <TText variant="bodySm" color="error" weight="semibold">
                        {t.commission.removeYes}
                      </TText>
                    </Pressable>
                    <Pressable onPress={() => setConfirming(null)} disabled={busy} accessibilityRole="button">
                      <TText variant="bodySm" color="textMuted" weight="semibold">
                        {t.commission.keep}
                      </TText>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setConfirming(r.from)} disabled={busy} accessibilityRole="button">
                    <TText variant="bodySm" color="error">
                      {t.commission.remove}
                    </TText>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {staff.history.length ? (
        <View style={styles.g2}>
          <TText variant="caption" color="textMuted" weight="bold" style={s.listTitle}>
            {t.commission.historyTitle.toUpperCase()}
          </TText>
          <View style={[s.list, { borderColor: colors.borderSubtle }]}>
            {staff.history.map((r, i) => (
              <View
                key={r.from}
                style={[s.listRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle }]}>
                <TText variant="bodySm" color="textMuted" style={styles.flex}>
                  {`${formatRate(r.rateBp)} · ${r.to ? formatDayRange(r.from, r.to) : formatDayKey(r.from)}`}
                </TText>
                {/* Days that are over keep the rate they were paid at. */}
                <Icon name="lock" size={14} color={colors.textSubtle} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = ({ radius }: ThemeStyleProps) =>
  StyleSheet.create({
    current: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.justifyBetween,
      gap: moderateScale(12),
      paddingHorizontal: moderateScale(14),
      paddingVertical: moderateScale(12),
      borderRadius: moderateScale(12),
    },
    currentValue: { flexShrink: 1, textAlign: 'right' },
    chips: { ...styles.flexRow, gap: moderateScale(8) },
    chip: {
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(6),
      borderWidth: moderateScale(1),
      borderRadius: moderateScale(radius.pill),
    },
    listTitle: { letterSpacing: 0.4 },
    list: { borderWidth: moderateScale(1), borderRadius: moderateScale(12), overflow: 'hidden' },
    listRow: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(12),
      minHeight: moderateScale(46),
      paddingHorizontal: moderateScale(14),
      paddingVertical: moderateScale(8),
    },
    confirm: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(14) },
  });
