import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { TEmptyState, TText } from '@/components/common';
import { CommissionEditSheet, SettingsPageShell } from '@/components/settings';
import { Icon } from '@/components/ui/Icon';
import { format, t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatDayKey, formatRate, type CommissionRates } from '@/lib/commission';
import { can } from '@/lib/permissions';
import { showToast } from '@/lib/toast';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Commission rates — what each stylist earns per visit, and from which day. The app's twin of
 * owner-web's /settings/commission. See docs/staff-commission.md.
 *
 * Owners only (`commission: manage`, which no staff login can hold). Reads live rather than through
 * the store, like Team logins: a short list, opened now and then, by the one person who edits it.
 */
export default function CommissionRatesScreen() {
  const theme = useTheme();
  const { colors } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const { session } = useAppState();
  const allowed = can(session?.permissions ?? null, 'commission', 'manage');
  const [rates, setRates] = useState<CommissionRates | null>(null);
  const [failed, setFailed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.getCommissionRates();
      setRates(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // First read. State is set only in the promise callbacks (as team.tsx does), never in the effect
  // body itself; `load` above is for the re-read after a save, which runs from an event handler.
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    api
      .getCommissionRates()
      .then((next) => {
        if (alive) setRates(next);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [allowed]);

  // Read from the latest list, so the open sheet shows what a save or a removal just changed.
  const editing = rates?.data.find((r) => r.staffId === editingId) ?? null;

  /** One write, then a fresh read. A day that rolled over while the sheet was open reads as locked. */
  const write = async (run: () => Promise<unknown>, ok: string, fail: string): Promise<boolean> => {
    setBusy(true);
    try {
      await run();
      showToast(ok, 'success');
      await load();
      return true;
    } catch (e) {
      const err = e as ApiError;
      const locked = err?.code === 'COMMISSION_RATE_LOCKED';
      showToast(locked ? t.commission.locked : (err?.message ?? fail), 'error');
      // Locked usually means the store's day moved on: refresh so "today" does too.
      if (locked) await load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (session && !allowed) return <Redirect href="/settings" />;

  return (
    <SettingsPageShell title={t.commission.title}>
      <TText variant="bodySm" color="textMuted" style={s.lead}>
        {t.commission.lead}
      </TText>

      {failed ? (
        <TEmptyState icon="percent" title={t.commission.errLoad} />
      ) : !rates ? (
        <View style={s.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : rates.data.length === 0 ? (
        <TEmptyState icon="users" title={t.commission.empty} />
      ) : (
        <View style={s.card}>
          {rates.data.map((r, i) => {
            const next = r.upcoming[0];
            const sub = [
              r.current
                ? format(t.commission.since, { rate: formatRate(r.current.rateBp), day: formatDayKey(r.current.from) })
                : t.commission.noRate,
              next ? format(t.commission.from, { rate: formatRate(next.rateBp), day: formatDayKey(next.from) }) : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Pressable
                key={r.staffId}
                onPress={() => setEditingId(r.staffId)}
                accessibilityRole="button"
                style={({ pressed }) => [s.row, i < rates.data.length - 1 && s.rowBorder, pressed && s.pressed]}>
                <View style={[s.avatar, { backgroundColor: colors.primary }]}>
                  <TText variant="bodyMd" weight="bold" style={{ color: colors.textOnBrand }}>
                    {r.name.trim().charAt(0).toUpperCase()}
                  </TText>
                </View>
                <View style={s.body}>
                  <TText variant="bodyMd" color="textStrong" weight="semibold">
                    {r.name}
                  </TText>
                  <TText variant="caption" color="textMuted" style={s.sub}>
                    {sub}
                  </TText>
                </View>
                <View style={[s.chip, { backgroundColor: r.current ? colors.primarySoft : colors.surfaceHover }]}>
                  <TText
                    variant="bodySm"
                    weight="bold"
                    style={{ color: r.current ? colors.primarySoftFg : colors.textMuted }}>
                    {r.current ? formatRate(r.current.rateBp) : t.commission.noRate}
                  </TText>
                </View>
                <Icon name="chevronRight" size={18} color={colors.textSubtle} />
              </Pressable>
            );
          })}
        </View>
      )}

      <CommissionEditSheet
        open={!!editing}
        staff={editing}
        today={rates?.today ?? ''}
        busy={busy}
        onClose={() => setEditingId(null)}
        onSave={async (rateBp, effectiveFrom) => {
          if (!editing) return;
          const done = await write(
            () => api.setCommissionRate(editing.staffId, rateBp, effectiveFrom),
            t.commission.saved,
            t.commission.errSave,
          );
          if (done) setEditingId(null);
        }}
        onRemove={(effectiveFrom) => {
          if (!editing) return;
          void write(
            () => api.deleteCommissionRate(editing.staffId, effectiveFrom),
            t.commission.removed,
            t.commission.errRemove,
          );
        }}
      />
    </SettingsPageShell>
  );
}

const createStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    lead: { ...styles.mb3, ...styles.mh1, lineHeight: moderateScale(18) },
    loading: { paddingVertical: moderateScale(40), ...styles.itemsCenter },
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
    },
    row: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g3,
      ...styles.ph4,
      paddingVertical: moderateScale(13),
    },
    rowBorder: { borderBottomWidth: moderateScale(1), borderBottomColor: colors.borderSubtle },
    pressed: { backgroundColor: colors.surfaceHover },
    avatar: {
      ...styles.nonFlexCenter,
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(18),
    },
    body: { ...styles.flex, ...styles.minWidth0 },
    sub: { marginTop: moderateScale(3) },
    chip: {
      paddingHorizontal: moderateScale(10),
      paddingVertical: moderateScale(3),
      borderRadius: moderateScale(999),
    },
  });
