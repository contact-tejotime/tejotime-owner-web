import React, { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { BookNewInline } from '@/components/appointments/RescheduleInline';
import { TButton, TText } from '@/components/common';
import { TMonthGrid } from '@/components/common/TMonthGrid';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { t } from '@/i18n';
import type { DueCustomerDTO, DueStatus, FollowupBody } from '@/lib/api';
import { dueBookFrom, dueLastLine, dueRhythmLine, dueStatusLabel } from '@/lib/due';
import { formatPhone } from '@/lib/phone';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

const TONE: Record<DueStatus, BadgeTone> = { due_soon: 'info', overdue: 'warning', lapsed: 'neutral' };

/**
 * One customer on the "Due to come back" list (docs/customer-due-list.md) — owner-web's
 * `customers/DueList.tsx` row. Call rings them; Book and Later open INLINE under the card, one at a
 * time, never as a modal: iOS will not present a second modal over an open one, and the pickers
 * here (month grid, slots) are the same inline ones Needs attention uses.
 *
 * What a call achieved goes to the store, which hides the card at once and offers Undo on the toast.
 */
export function DueCard({
  c,
  today,
  callBackRange,
  canBook,
  canLog,
  onBook,
  onLog,
}: {
  c: DueCustomerDTO;
  /** The store's today, from the API. */
  today: string;
  callBackRange: { min: string; max: string };
  /** `appointments: manage`. */
  canBook: boolean;
  /** `customers: manage`. */
  canLog: boolean;
  onBook: (slotStart: string, staffId: string | undefined, serviceIds: string[]) => Promise<boolean>;
  onLog: (body: FollowupBody) => Promise<boolean>;
}) {
  const theme = useTheme();
  const { colors } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const [panel, setPanel] = useState<'book' | 'later' | null>(null);
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(callBackRange.min);
  const last = dueLastLine(c);

  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.card}>
      <View style={s.row}>
        <InitialsAvatar name={c.name} size={44} />
        <View style={s.body}>
          <TText variant="bodyMd" color="textStrong" weight="semibold">
            {c.name}
          </TText>
          <TText variant="bodySm" color="textMuted" style={s.mt1}>
            {formatPhone(c.phone)}
          </TText>
        </View>
        <Badge tone={TONE[c.status]} size="sm">
          {dueStatusLabel(c.status)}
        </Badge>
      </View>
      <TText variant="bodySm" color="textBody" style={s.line}>
        {dueRhythmLine(c)}
      </TText>
      {last ? (
        <TText variant="bodySm" color="textMuted" style={s.mt1}>
          {last}
        </TText>
      ) : null}

      {panel === 'book' ? (
        <View style={s.panel}>
          <BookNewInline
            initialDate={dueBookFrom(c, today)}
            staffId={c.lastStaff?.active ? c.lastStaff.id : null}
            serviceIds={c.serviceIds}
            servicesResolved={c.servicesResolved}
            busy={busy}
            onBook={(slotStart, staffId, serviceIds) => run(() => onBook(slotStart, staffId, serviceIds))}
            onBack={() => setPanel(null)}
          />
        </View>
      ) : panel === 'later' ? (
        <View style={s.panel}>
          <TButton
            variant="outline"
            size="sm"
            loading={busy}
            onPress={() => void run(() => onLog({ outcome: 'no_answer' }))}>
            {t.customers.due.noAnswer}
          </TButton>
          <TText variant="caption" color="textMuted" weight="semibold" style={s.label}>
            {t.customers.due.callBackOn}
          </TText>
          <TMonthGrid
            mode="single"
            value={{ from: day, to: day }}
            onChange={(r) => r.from && setDay(r.from)}
            todayKey={today}
            minKey={callBackRange.min}
            maxKey={callBackRange.max}
          />
          <View style={s.buttons}>
            <TButton
              size="sm"
              loading={busy}
              onPress={() => void run(() => onLog({ outcome: 'call_later', callBackOn: day }))}>
              {t.customers.due.save}
            </TButton>
            <TButton variant="outline" size="sm" disabled={busy} onPress={() => setPanel(null)}>
              {t.customers.due.cancel}
            </TButton>
          </View>
        </View>
      ) : (
        <View style={s.buttons}>
          {c.phone ? (
            <TButton
              variant="outline"
              size="sm"
              leadingIcon={<Icon name="phone" size={14} color={colors.primary} />}
              onPress={() => void Linking.openURL(`tel:${c.phone}`)}>
              {t.customers.due.call}
            </TButton>
          ) : null}
          {canBook ? (
            <TButton size="sm" onPress={() => setPanel('book')}>
              {t.customers.due.book}
            </TButton>
          ) : null}
          {canLog ? (
            <TButton variant="ghost" size="sm" textColor={colors.primary} onPress={() => setPanel('later')}>
              {t.customers.due.later}
            </TButton>
          ) : null}
          {canLog ? (
            <TButton
              variant="ghost"
              size="sm"
              textColor={colors.textMuted}
              loading={busy}
              onPress={() => void run(() => onLog({ outcome: 'not_interested' }))}>
              {t.customers.due.notInterested}
            </TButton>
          ) : null}
        </View>
      )}
    </View>
  );
}

const createStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      ...styles.p4,
      ...shadow.xs,
    },
    row: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g3 },
    body: { ...styles.flex, ...styles.minWidth0 },
    mt1: { ...styles.mt1 },
    line: { marginTop: moderateScale(10) },
    label: { marginTop: moderateScale(6) },
    buttons: { ...styles.flexRow, ...styles.wrap, gap: moderateScale(8), marginTop: moderateScale(12) },
    panel: {
      marginTop: moderateScale(12),
      paddingTop: moderateScale(12),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderSubtle,
      gap: moderateScale(8),
    },
  });
