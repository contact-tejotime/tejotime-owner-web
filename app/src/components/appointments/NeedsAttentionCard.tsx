import React, { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { TButton, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { format, t } from '@/i18n';
import type { SeriesIssueDTO } from '@/lib/api';
import { issueReasonLabel, visitWhen } from '@/lib/series';
import type { MoveTarget } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

import { BookAnotherInline } from './RescheduleInline';

/**
 * Series dates the background job could not book (docs/recurring-appointments.md §3.4), at the top
 * of Today. Nothing is texted to the customer when this happens — the client's SMS rule — so every
 * item carries a Call button: the owner phones them, then books another time, skips (from the
 * series sheet) or marks it handled. Tapping the name opens that regular's series sheet.
 */
export function NeedsAttentionCard({
  issues,
  canManage,
  onResolve,
  onBook,
  onOpenSeries,
}: {
  issues: SeriesIssueDTO[];
  canManage: boolean;
  onResolve: (issueId: string) => Promise<void>;
  onBook: (issueId: string, move: MoveTarget) => Promise<boolean>;
  onOpenSeries: (seriesId: string) => void;
}) {
  const theme = useTheme();
  const { colors } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const [resolving, setResolving] = useState<string | null>(null);
  /** The item whose "Book another time" picker is open (one at a time). */
  const [booking, setBooking] = useState<string | null>(null);
  const [bookBusy, setBookBusy] = useState(false);

  const resolve = async (id: string) => {
    setResolving(id);
    await onResolve(id);
    setResolving(null);
  };
  const book = async (id: string, move: MoveTarget) => {
    setBookBusy(true);
    const ok = await onBook(id, move);
    setBookBusy(false);
    if (ok) setBooking(null);
    return ok;
  };

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Icon name="alertTriangle" size={18} color={colors.warning} />
        <TText variant="bodyMd" color="textStrong" weight="bold">
          {t.series.attentionTitle}
        </TText>
      </View>
      <TText variant="bodySm" color="textMuted" style={s.lead}>
        {t.series.attentionBody}
      </TText>
      {issues.map((i) => (
        <View key={i.id} style={s.item}>
          <Pressable
            onPress={() => onOpenSeries(i.seriesId)}
            accessibilityRole="button"
            accessibilityHint={format(t.series.openSeries, { name: i.customerName })}>
            <TText variant="bodyMd" color="textStrong" weight="semibold">
              {i.customerName}
            </TText>
            <TText variant="bodySm" color="textBody" style={s.line}>
              {visitWhen(i.scheduledStartAt)}
            </TText>
            <TText variant="caption" weight="semibold" style={[s.line, { color: colors.warningSoftFg }]}>
              {issueReasonLabel(i.reason)}
            </TText>
          </Pressable>
          {booking === i.id ? (
            <View style={s.picker}>
              <BookAnotherInline
                seriesId={i.seriesId}
                date={i.occurrenceDate}
                staffId={i.staffId}
                busy={bookBusy}
                onBook={(slotStart, staffId) => book(i.id, { slotStart, staffId })}
                onBack={() => setBooking(null)}
              />
            </View>
          ) : (
            <View style={s.buttons}>
              {i.customerPhone ? (
                <TButton
                  variant="outline"
                  size="sm"
                  leadingIcon={<Icon name="phone" size={14} color={colors.primary} />}
                  onPress={() => void Linking.openURL(`tel:${i.customerPhone}`)}>
                  {t.series.call}
                </TButton>
              ) : null}
              {canManage ? (
                <TButton variant="outline" size="sm" onPress={() => setBooking(i.id)}>
                  {t.series.bookAnother}
                </TButton>
              ) : null}
              {canManage ? (
                <TButton
                  variant="ghost"
                  size="sm"
                  textColor={colors.primary}
                  loading={resolving === i.id}
                  onPress={() => void resolve(i.id)}>
                  {t.series.markHandled}
                </TButton>
              ) : null}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const createStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderLeftWidth: moderateScale(3),
      borderLeftColor: colors.warning,
      borderRadius: moderateScale(radius.md),
      ...styles.p4,
      ...shadow.xs,
      marginTop: moderateScale(14),
    },
    head: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(8) },
    lead: { marginTop: moderateScale(4) },
    item: {
      marginTop: moderateScale(12),
      paddingTop: moderateScale(12),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderSubtle,
    },
    line: { marginTop: moderateScale(2) },
    buttons: { ...styles.flexRow, ...styles.wrap, gap: moderateScale(8), marginTop: moderateScale(10) },
    picker: { marginTop: moderateScale(12) },
  });
