import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TButton, TFormattedDate, TText } from '@/components/common';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { format, t } from '@/i18n';
import { AppointmentEntry } from '@/data/sample';
import type { ApptAction, MoveTarget } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

import { MoveVisitInline } from './RescheduleInline';

// Only an appointment still waiting to arrive can be checked into the queue —
// once it's checked in / finished / cancelled / no-showed, show its status instead.
const CHECK_IN_ELIGIBLE = new Set(['upcoming', 'confirmed']);

/**
 * What a booking that is still to arrive can do, besides Add to queue:
 * - before its time: **Reschedule**, and **Skip** for a visit of a repeating booking (the rest of
 *   the series stays booked) or **Cancel** for a one-off;
 * - once its time has passed: only **Mark no-show**.
 * The API would still move a booking whose time passed earlier today; the row offers it only while
 * the start is ahead, the same as owner-web, so the two surfaces show the same choices.
 * "Now" is the moment the menu was opened, not render time, so a row drawn at 9:59 still offers
 * the right thing when it is opened at 10:01.
 */
function actionsFor(a: AppointmentEntry, now: number): ApptAction[] {
  const upcoming = new Date(a.startAt).getTime() > now;
  if (!upcoming) return ['noShow'];
  return ['reschedule', a.seriesId ? 'skip' : 'cancel'];
}

const ACTION_LABEL: Record<ApptAction, string> = {
  reschedule: t.appointments.reschedule,
  skip: t.appointments.skip,
  cancel: t.appointments.cancel,
  noShow: t.appointments.markNoShow,
};

/**
 * Skip and Cancel ask first — Skip with the same words as the series sheet, as owner-web does; a
 * no-show is marked straight away, as on the queue's detail panel. Reschedule has its own flow.
 */
const CONFIRM: Partial<Record<ApptAction, { body: string; yes: string; no: string }>> = {
  skip: { body: t.appointments.skipConfirm, yes: t.appointments.skipYes, no: t.appointments.skipNo },
  cancel: { body: t.appointments.cancelConfirm, yes: t.appointments.cancelYes, no: t.appointments.cancelNo },
};

export function AppointmentListItem({
  appointment,
  staffName,
  checkInLoading,
  onCheckIn,
  canManage = false,
  actionBusy = null,
  onAction,
  onOpenSeries,
}: {
  appointment: AppointmentEntry;
  staffName?: string | null;
  checkInLoading: boolean;
  onCheckIn: (a: AppointmentEntry) => void;
  /**
   * `appointments: manage`. Gates the row actions only — the API refuses them without it, and
   * a button that always fails is worse than none. (Add to queue keeps its old behaviour.)
   */
  canManage?: boolean;
  /** The action running on THIS row, so only its button spins. */
  actionBusy?: ApptAction | null;
  /**
   * Resolves true when it worked, which folds the actions away. Omitted (no actions) in the
   * calendar's day sheet, as owner-web's calendar has none.
   */
  onAction?: (a: AppointmentEntry, kind: ApptAction, move?: MoveTarget) => Promise<boolean>;
  /** Tapping a visit of a repeating booking opens its series sheet. */
  onOpenSeries?: (seriesId: string) => void;
}) {
  const theme = useTheme();
  const s = useMemo(() => createAppointmentListItemStyles(theme), [theme]);
  const checkInEligible = CHECK_IN_ELIGIBLE.has(appointment.status);
  // Service and stylist are both optional, so either (or both) may be missing.
  const serviceLine = [appointment.service, staffName].filter(Boolean).join(' · ');
  const skipped = appointment.status === 'cancelled' && appointment.cancelReason === 'skipped';
  const showActions = canManage && checkInEligible && !!onAction;
  const seriesId = appointment.seriesId;

  /**
   * Inline, not an action sheet: iOS will not present a second modal over an open one (see
   * CommissionEditSheet), and the move flow's picker must sit somewhere. The same strip works the
   * same way on both platforms. Null = folded; otherwise the moment it was opened.
   */
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  /** Which step the strip is on: the list of actions, one action's confirmation, or Move visit. */
  const [step, setStep] = useState<ApptAction | null>(null);
  const actions = openedAt != null ? actionsFor(appointment, openedAt) : [];
  const confirm = step ? CONFIRM[step] : undefined;

  const toggle = () => {
    setStep(null);
    setOpenedAt(openedAt == null ? Date.now() : null);
  };
  const run = async (kind: ApptAction, move?: MoveTarget) => {
    if (!onAction) return false;
    const ok = await onAction(appointment, kind, move);
    if (ok) {
      setOpenedAt(null);
      setStep(null);
    }
    return ok;
  };
  const choose = (kind: ApptAction) => {
    if (kind === 'reschedule' || CONFIRM[kind]) setStep(kind);
    else void run(kind);
  };

  const body = (
    <>
      <View style={s.nameRow}>
        <TText variant="bodyMd" color="textStrong" weight="semibold" style={s.nameText}>
          {appointment.name}
        </TText>
        {seriesId ? (
          <View accessible accessibilityLabel={t.series.repeating} style={s.repeat}>
            <Icon name="repeat" size={14} color={theme.colors.primary} />
          </View>
        ) : null}
        {appointment.moved && checkInEligible ? (
          <Badge tone="neutral" size="sm">
            {t.appointments.moved}
          </Badge>
        ) : null}
        {appointment.visitorType && (
          <Badge tone={appointment.visitorType === 'mr' ? 'info' : 'secondary'} size="sm">
            {appointment.visitorType === 'mr' ? t.queue.mr : t.queue.patient}
          </Badge>
        )}
      </View>
      <TText variant="caption" color="textMuted" style={s.service}>
        {serviceLine}
      </TText>
    </>
  );

  return (
    <View style={s.root}>
      <View style={s.row}>
        <TFormattedDate value={appointment.time} variant="bodySm" color="textMuted" weight="semibold" style={s.time} />
        <View style={s.card}>
          {/* A series visit opens its series sheet, where every visit of it can be managed. */}
          {seriesId && onOpenSeries ? (
            <Pressable
              onPress={() => onOpenSeries(seriesId)}
              accessibilityRole="button"
              accessibilityHint={format(t.series.openSeries, { name: appointment.name })}
              style={s.body}>
              {body}
            </Pressable>
          ) : (
            <View style={s.body}>{body}</View>
          )}
          {checkInEligible ? (
            <TButton
              variant="ghost"
              size="sm"
              loading={checkInLoading}
              onPress={() => onCheckIn(appointment)}
              textColor={theme.colors.primary}>
              {t.appointments.addToQueue}
            </TButton>
          ) : (
            <StatusBadge status={appointment.status} label={skipped ? t.series.skipped : undefined} />
          )}
          {showActions ? (
            <IconButton
              size="sm"
              onPress={toggle}
              accessibilityLabel={format(t.appointments.moreActions, { name: appointment.name })}>
              <Icon name="moreVertical" size={18} color={theme.colors.textMuted} />
            </IconButton>
          ) : null}
        </View>
      </View>

      {/* The full width of the row, not inside the card: the move flow's month grid needs it. */}
      {showActions && openedAt != null ? (
        <View style={s.strip}>
          {step === 'reschedule' ? (
            <MoveVisitInline
              appointmentId={appointment.id}
              startAt={appointment.startAt}
              staffId={appointment.staffId}
              busy={actionBusy === 'reschedule'}
              onMove={(slotStart, staffId) => run('reschedule', { slotStart, staffId })}
              onBack={() => setStep(null)}
            />
          ) : step && confirm ? (
            <>
              <TText variant="bodySm" color="textBody">
                {confirm.body}
              </TText>
              <View style={s.stripButtons}>
                <TButton variant="danger" size="sm" loading={actionBusy === step} onPress={() => void run(step)}>
                  {confirm.yes}
                </TButton>
                <TButton variant="outline" size="sm" disabled={!!actionBusy} onPress={() => setStep(null)}>
                  {confirm.no}
                </TButton>
              </View>
            </>
          ) : (
            <View style={s.stripButtons}>
              {actions.map((kind) => (
                <TButton
                  key={kind}
                  variant="outline"
                  size="sm"
                  loading={actionBusy === kind}
                  disabled={!!actionBusy}
                  onPress={() => choose(kind)}>
                  {ACTION_LABEL[kind]}
                </TButton>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const createAppointmentListItemStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    root: { gap: moderateScale(8) },
    row: { ...styles.flexRow, ...styles.g3 },
    time: {
      width: moderateScale(56),
      paddingTop: moderateScale(14),
      textAlign: 'right',
    },
    card: {
      ...styles.flex,
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g2,
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderLeftWidth: moderateScale(3),
      borderLeftColor: colors.primary,
      borderRadius: moderateScale(radius.md),
      ...styles.pv3,
      ...styles.ph4,
      ...shadow.xs,
    },
    body: { ...styles.flex, ...styles.minWidth0 },
    nameRow: { ...styles.flexRow, ...styles.itemsCenter, ...styles.wrap, gap: moderateScale(6) },
    nameText: { flexShrink: 1 },
    repeat: { paddingHorizontal: moderateScale(2) },
    service: { ...styles.mt1 },
    strip: {
      gap: moderateScale(8),
      padding: moderateScale(12),
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.md),
    },
    stripButtons: { ...styles.flexRow, ...styles.wrap, gap: moderateScale(8) },
  });
