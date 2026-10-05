import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChangeFuturePanel } from '@/components/appointments/ChangeFuturePanel';
import { BookAnotherInline, MoveVisitInline } from '@/components/appointments/RescheduleInline';
import { TButton, TSheet, TText } from '@/components/common';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useResponsive } from '@/hooks/useResponsive';
import { t } from '@/i18n';
import { api, ApiError, type AppointmentDTO, type SeriesDetail } from '@/lib/api';
import { can } from '@/lib/permissions';
import {
  endLabel,
  issueReasonLabel,
  laterDatesLabel,
  pauseReasonLabel,
  rhythmLabel,
  statusLabel,
  stylistLabel,
  visitWhen,
} from '@/lib/series';
import { showToast } from '@/lib/toast';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * One regular's repeating booking — the app's twin of owner-web's series sheet
 * (docs/recurring-appointments.md §2). Mounted once in (app)/_layout.tsx and opened through the
 * store (`openSeries`) from a Regulars row, a series visit (Today or the Calendar day sheet) or a
 * Needs attention item. Phase 2 adds Reschedule per visit, Book another time per item, and
 * Change future visits (ChangeFuturePanel).
 *
 * It reads the series live rather than through the store — one regular, opened now and then — and
 * re-reads whenever `seriesRev` moves (a socket event, or an action taken on another screen).
 *
 * Every confirmation is INLINE: this is already a modal, and iOS will not present a second one
 * over it (see CommissionEditSheet). Nothing here texts the customer — the client's SMS rule — so
 * the Call button sits at the top, where the owner needs it for every one of these actions.
 */
export function SeriesSheet() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const store = useAppState();
  const { centerStyle } = useResponsive(560);
  const s = useMemo(() => createStyles(theme, insets.bottom), [theme, insets.bottom]);

  const id = store.seriesSheetId;
  // Keep showing the last series while the sheet animates out (TSheet stays mounted through it).
  const [shown, setShown] = useState(id);
  if (id && id !== shown) setShown(id);

  return (
    <TSheet visible={!!id} onClose={store.closeSeries} contentStyle={[s.sheet, centerStyle]}>
      <View style={s.handle} />
      {shown ? <SeriesBody key={shown} id={shown} rev={store.seriesRev} styles={s} /> : null}
    </TSheet>
  );
}

type Busy = 'pause' | 'resume' | 'cancel' | null;

function SeriesBody({ id, rev, styles: s }: { id: string; rev: number; styles: ReturnType<typeof createStyles> }) {
  const { colors } = useTheme();
  const store = useAppState();
  const canManage = can(store.session?.permissions ?? null, 'appointments', 'manage');

  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  /**
   * Which inline step is open — one at a time: the series cancel, one visit's skip or move, or
   * one Needs attention date's "Book another time".
   */
  const [confirming, setConfirming] = useState<
    | { kind: 'cancel' }
    | { kind: 'skip'; visitId: string }
    | { kind: 'move'; visitId: string }
    | { kind: 'book'; issueId: string }
    | null
  >(null);
  /** "Change future visits" is open in place of the series actions. */
  const [changing, setChanging] = useState(false);
  const [booking, setBooking] = useState(false);
  /** "Choose who takes this series" — before a resume whose stylist has left. */
  const [picking, setPicking] = useState(false);

  // Remounted (via key) per series; `rev` re-reads it whenever something may have changed it.
  useEffect(() => {
    let alive = true;
    api
      .getSeries(id)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setFailed(false);
      })
      .catch(() => {
        // A failed RE-read keeps what is on screen; only a first read has nothing to show.
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [id, rev]);

  const series = detail?.series ?? null;

  /** Visits still ahead (on the server's clock): the ones to skip, and the ones already skipped. */
  const upcoming = useMemo(() => {
    if (!detail) return [];
    const now = new Date(detail.now).getTime();
    return detail.visits.filter(
      (v) =>
        new Date(v.scheduledStartAt).getTime() > now &&
        (v.status === 'pending' || v.status === 'confirmed' || v.cancelReason === 'skipped'),
    );
  }, [detail]);

  if (!series) {
    return failed ? (
      <TText variant="bodySm" color="textMuted" style={s.note}>
        {t.series.loadError}
      </TText>
    ) : (
      <View style={s.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  /** Pause / resume / cancel answer with the fresh detail; then every other screen re-reads. */
  const act = async (kind: Exclude<Busy, null>, call: () => Promise<SeriesDetail>, done: string) => {
    setBusy(kind);
    try {
      const next = await call();
      setDetail(next);
      setConfirming(null);
      setPicking(false);
      showToast(done, 'success');
      store.refreshSeriesViews();
    } catch (e) {
      const err = e as ApiError;
      // The API refuses a resume onto a stylist who has left (400 on `staffId`) — e.g. one who
      // left after an owner pause, which `pauseReason` alone does not reveal. Ask, then retry.
      if (kind === 'resume' && err?.status === 400 && err.code === 'VALIDATION_ERROR') setPicking(true);
      showToast(err?.message ?? t.toast.error, 'error');
    } finally {
      setBusy(null);
    }
  };

  const resume = (staffId?: string) => {
    if (!staffId && series.pauseReason === 'stylist_unavailable') {
      setPicking(true);
      return;
    }
    void act('resume', () => api.resumeSeries(series.id, staffId), t.series.resumed);
  };

  const skip = async (v: AppointmentDTO) => {
    const ok = await store.actOnAppt({ id: v.id, seriesId: v.seriesId }, 'skip');
    if (ok) setConfirming(null);
  };

  /** Move one visit; the store re-reads this sheet (seriesRev), which then shows it "Moved". */
  const move = async (v: AppointmentDTO, slotStart: string, staffId: string | undefined) => {
    const ok = await store.actOnAppt({ id: v.id, seriesId: v.seriesId }, 'reschedule', { slotStart, staffId });
    if (ok) setConfirming(null);
    return ok;
  };

  const bookAnother = async (issueId: string, slotStart: string, staffId: string | undefined) => {
    setBooking(true);
    const ok = await store.bookSeriesIssue(issueId, { slotStart, staffId });
    setBooking(false);
    if (ok) setConfirming(null);
    return ok;
  };

  const resolve = async (issueId: string) => {
    setResolving(issueId);
    await store.resolveSeriesIssue(issueId);
    setResolving(null);
  };

  const pauseNote = series.status === 'paused' ? pauseReasonLabel(series.pauseReason) : null;
  const facts: [string, string][] = [
    [t.series.factRepeats, rhythmLabel(series)],
    [t.series.factEnds, endLabel(series)],
    [t.series.factStylist, stylistLabel(series)],
    [t.series.factService, series.serviceName || t.common.dash],
  ];
  const anyBusy = busy !== null;

  return (
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
      <View style={s.head}>
        <View style={s.headText}>
          <TText variant="h4" weight="semibold" numberOfLines={2}>
            {series.customerName}
          </TText>
          {series.status !== 'active' ? (
            <View style={s.headBadge}>
              <Badge tone={series.status === 'paused' ? 'warning' : 'neutral'} size="sm">
                {statusLabel(series.status)}
              </Badge>
            </View>
          ) : null}
        </View>
        {series.customerPhone ? (
          <TButton
            variant="outline"
            size="sm"
            leadingIcon={<Icon name="phone" size={14} color={colors.primary} />}
            onPress={() => void Linking.openURL(`tel:${series.customerPhone}`)}>
            {t.series.call}
          </TButton>
        ) : null}
      </View>

      {pauseNote ? (
        <TText variant="bodySm" color="textBody" weight="semibold" style={s.pauseNote}>
          {pauseNote}
        </TText>
      ) : null}

      <View style={[s.facts, { borderColor: colors.borderSubtle }]}>
        {facts.map(([label, value], i) => (
          <View key={label} style={[s.fact, i > 0 && { borderTopColor: colors.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <TText variant="caption" color="textMuted" style={s.factLabel}>
              {label}
            </TText>
            <TText variant="bodySm" color="textStrong" weight="semibold" style={s.factValue}>
              {value}
            </TText>
          </View>
        ))}
      </View>

      {detail!.issues.length > 0 ? (
        <View style={s.section}>
          <TText variant="bodySm" color="textStrong" weight="bold" style={s.sectionTitle}>
            {t.series.attentionTitle}
          </TText>
          {detail!.issues.map((i) => {
            const bookingThis = confirming?.kind === 'book' && confirming.issueId === i.id;
            return (
              <View key={i.id} style={[s.issue, { backgroundColor: colors.warningSoft }]}>
                <TText variant="bodySm" color="textStrong" weight="semibold">
                  {visitWhen(i.scheduledStartAt)}
                </TText>
                <TText variant="caption" style={{ color: colors.warningSoftFg }}>
                  {issueReasonLabel(i.reason)}
                </TText>
                {bookingThis ? (
                  <View style={[s.inline, { backgroundColor: colors.surfaceCard }]}>
                    <BookAnotherInline
                      seriesId={series.id}
                      date={i.occurrenceDate}
                      staffId={i.staffId}
                      busy={booking}
                      onBook={(slotStart, staffId) => bookAnother(i.id, slotStart, staffId)}
                      onBack={() => setConfirming(null)}
                    />
                  </View>
                ) : canManage ? (
                  <View style={s.buttons}>
                    <TButton variant="outline" size="sm" onPress={() => setConfirming({ kind: 'book', issueId: i.id })}>
                      {t.series.bookAnother}
                    </TButton>
                    <TButton variant="outline" size="sm" loading={resolving === i.id} onPress={() => void resolve(i.id)}>
                      {t.series.markHandled}
                    </TButton>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={s.section}>
        <TText variant="bodySm" color="textStrong" weight="bold" style={s.sectionTitle}>
          {t.series.upcomingVisits}
        </TText>
        {upcoming.length === 0 ? (
          <TText variant="bodySm" color="textMuted">
            {t.series.noNextVisit}
          </TText>
        ) : (
          upcoming.map((v) => {
            const skipped = v.status === 'cancelled' && v.cancelReason === 'skipped';
            const asking = confirming?.kind === 'skip' && confirming.visitId === v.id;
            const moving = confirming?.kind === 'move' && confirming.visitId === v.id;
            const skipping = store.apptAction?.id === v.id && store.apptAction.kind === 'skip';
            return (
              <View key={v.id} style={[s.visit, { borderBottomColor: colors.borderSubtle }]}>
                <View style={s.visitRow}>
                  <View style={s.flex1}>
                    <TText variant="bodySm" color={skipped ? 'textMuted' : 'textStrong'} weight="semibold">
                      {visitWhen(v.scheduledStartAt)}
                    </TText>
                    {v.rescheduledAt && !skipped ? (
                      <TText variant="caption" color="textMuted">
                        {t.appointments.moved}
                      </TText>
                    ) : null}
                  </View>
                  {skipped ? (
                    <StatusBadge status="cancelled" label={t.series.skipped} />
                  ) : canManage && !asking && !moving ? (
                    <>
                      <TButton
                        variant="ghost"
                        size="sm"
                        textColor={colors.primary}
                        onPress={() => setConfirming({ kind: 'move', visitId: v.id })}>
                        {t.appointments.reschedule}
                      </TButton>
                      <TButton
                        variant="ghost"
                        size="sm"
                        textColor={colors.primary}
                        onPress={() => setConfirming({ kind: 'skip', visitId: v.id })}>
                        {t.appointments.skip}
                      </TButton>
                    </>
                  ) : null}
                </View>
                {moving ? (
                  <View style={s.inlineFlat}>
                    <MoveVisitInline
                      appointmentId={v.id}
                      startAt={v.scheduledStartAt}
                      staffId={v.staffId}
                      busy={store.apptAction?.id === v.id && store.apptAction.kind === 'reschedule'}
                      onMove={(slotStart, staffId) => move(v, slotStart, staffId)}
                      onBack={() => setConfirming(null)}
                    />
                  </View>
                ) : null}
                {asking ? (
                  <View style={s.confirm}>
                    <TText variant="bodySm" color="textBody">
                      {t.appointments.skipConfirm}
                    </TText>
                    <View style={s.buttons}>
                      <TButton variant="danger" size="sm" loading={skipping} onPress={() => void skip(v)}>
                        {t.appointments.skipYes}
                      </TButton>
                      <TButton variant="outline" size="sm" disabled={skipping} onPress={() => setConfirming(null)}>
                        {t.appointments.skipNo}
                      </TButton>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
        {detail!.laterDates.length > 0 ? (
          <TText variant="caption" color="textMuted" style={s.later}>
            {laterDatesLabel(detail!.laterDates)}
          </TText>
        ) : null}
      </View>

      {canManage && series.status !== 'cancelled' ? (
        <View style={s.actions}>
          {changing ? (
            <ChangeFuturePanel
              series={series}
              detail={detail!}
              onDone={(next) => {
                setDetail(next);
                setChanging(false);
                store.refreshSeriesViews();
              }}
              onBack={() => setChanging(false)}
            />
          ) : picking ? (
            <View style={s.confirm}>
              <TText variant="bodySm" color="textStrong" weight="semibold">
                {t.series.chooseStylist}
              </TText>
              <View style={s.chips}>
                {store.staff.map((st) => (
                  <Pressable
                    key={st.id}
                    disabled={anyBusy}
                    onPress={() => resume(st.id)}
                    accessibilityRole="button"
                    style={[s.chip, { borderColor: colors.borderDefault, backgroundColor: colors.surfaceCard }]}>
                    <TText variant="bodySm" weight="semibold" color="textBody">
                      {st.name}
                    </TText>
                  </Pressable>
                ))}
                <Pressable
                  disabled={anyBusy}
                  onPress={() => resume('any')}
                  accessibilityRole="button"
                  style={[s.chip, { borderColor: colors.borderDefault, backgroundColor: colors.surfaceCard }]}>
                  <TText variant="bodySm" weight="semibold" color="textBody">
                    {t.series.anyStylist}
                  </TText>
                </Pressable>
              </View>
              {busy === 'resume' ? <ActivityIndicator color={colors.primary} style={styles.selfStart} /> : null}
              <TButton variant="outline" size="sm" disabled={anyBusy} onPress={() => setPicking(false)}>
                {t.common.back}
              </TButton>
            </View>
          ) : confirming?.kind === 'cancel' ? (
            <View style={s.confirm}>
              <TText variant="bodySm" color="textBody">
                {t.series.cancelConfirm}
              </TText>
              <View style={s.buttons}>
                <TButton
                  variant="danger"
                  size="sm"
                  loading={busy === 'cancel'}
                  onPress={() => void act('cancel', () => api.cancelSeries(series.id), t.series.cancelled)}>
                  {t.series.cancelSeries}
                </TButton>
                <TButton variant="outline" size="sm" disabled={anyBusy} onPress={() => setConfirming(null)}>
                  {t.series.keepSeries}
                </TButton>
              </View>
            </View>
          ) : (
            <View style={s.buttons}>
              {/* New time and/or stylist from an upcoming date on — only while active, and only
                  from the dates the API offers (changeFromDates). */}
              {series.status === 'active' && detail!.changeFromDates.length > 0 ? (
                <TButton
                  variant="outline"
                  disabled={anyBusy}
                  onPress={() => {
                    setConfirming(null);
                    setChanging(true);
                  }}>
                  {t.series.changeFuture}
                </TButton>
              ) : null}
              {series.status === 'active' ? (
                <TButton
                  variant="outline"
                  loading={busy === 'pause'}
                  disabled={anyBusy}
                  onPress={() => void act('pause', () => api.pauseSeries(series.id), t.series.paused)}>
                  {t.series.pause}
                </TButton>
              ) : null}
              {series.status === 'paused' ? (
                <TButton variant="primary" loading={busy === 'resume'} disabled={anyBusy} onPress={() => resume()}>
                  {t.series.resume}
                </TButton>
              ) : null}
              <TButton
                variant="outline"
                textColor={colors.error}
                disabled={anyBusy}
                onPress={() => setConfirming({ kind: 'cancel' })}>
                {t.series.cancelSeries}
              </TButton>
            </View>
          )}
        </View>
      ) : null}
    </ScrollView>
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
      // Bottom-anchored: capped so a long visit list scrolls instead of pushing the name off-screen.
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
    scroll: { flexGrow: 0, flexShrink: 1 },
    loading: { paddingVertical: moderateScale(28), ...styles.itemsCenter },
    note: { marginTop: moderateScale(4), marginBottom: moderateScale(12) },
    head: { ...styles.flexRow, ...styles.itemsStart, gap: moderateScale(12) },
    headText: { ...styles.flex, ...styles.minWidth0 },
    headBadge: { ...styles.flexRow, marginTop: moderateScale(6) },
    pauseNote: { marginTop: moderateScale(10) },
    facts: {
      marginTop: moderateScale(14),
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: moderateScale(radius.md),
      paddingHorizontal: moderateScale(12),
    },
    fact: { ...styles.flexRow, ...styles.itemsStart, gap: moderateScale(12), paddingVertical: moderateScale(10) },
    factLabel: { width: moderateScale(72), paddingTop: moderateScale(1) },
    factValue: { ...styles.flex, ...styles.minWidth0 },
    section: { marginTop: moderateScale(18) },
    sectionTitle: { marginBottom: moderateScale(6) },
    issue: {
      gap: moderateScale(4),
      padding: moderateScale(10),
      borderRadius: moderateScale(radius.md),
      marginBottom: moderateScale(6),
    },
    // A picker opened on a Needs attention item: its own card on the warning tint.
    inline: { marginTop: moderateScale(8), padding: moderateScale(10), borderRadius: moderateScale(radius.md) },
    inlineFlat: { paddingTop: moderateScale(6), paddingBottom: moderateScale(8) },
    flex1: { ...styles.flex, ...styles.minWidth0 },
    visit: { paddingVertical: moderateScale(6), borderBottomWidth: StyleSheet.hairlineWidth },
    visitRow: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(10), minHeight: moderateScale(36) },
    confirm: { gap: moderateScale(8), paddingVertical: moderateScale(6) },
    buttons: { ...styles.flexRow, ...styles.wrap, gap: moderateScale(8) },
    later: { marginTop: moderateScale(8) },
    actions: { marginTop: moderateScale(20) },
    chips: { ...styles.flexRow, ...styles.wrap, gap: moderateScale(8) },
    chip: {
      borderWidth: moderateScale(1),
      borderRadius: moderateScale(radius.pill),
      paddingHorizontal: moderateScale(14),
      paddingVertical: moderateScale(8),
    },
  });
