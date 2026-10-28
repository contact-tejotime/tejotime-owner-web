import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState as RNAppState, StyleSheet, View } from 'react-native';

import { TSettingsRow, TSwitch, TText } from '@/components/common';
import { ConfirmSheet } from '@/components/feedback/ConfirmSheet';
import { SettingsPageShell } from '@/components/settings';
import { Button } from '@/components/ui/Button';
import { t, format } from '@/i18n';
import { api, ApiError, type CardPayment, type CardPaymentSettings } from '@/lib/api';
import { RefundError, refundCardPayment } from '@/lib/card-payment-flow';
import { isUsStore } from '@/lib/checkout-amount';
import { cardReader, cardReaderDevMode, isCardReaderAvailable, type ReaderAccount } from '@/lib/card-reader';
import { formatMoney } from '@/lib/mappers';
import { showToast } from '@/lib/toast';
import { dayKeyToLocalDate, storeDayKey, storeTimeLabel } from '@/lib/zoned';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Settings → Card payments — the PayPal POS Card Reader (docs/card-payments-paypal.md).
 *
 * MAIN OWNER ONLY (client decision 2026-10-15): the money lands in their PayPal account, and they
 * charge and refund on their own phone. Everyone else is sent back; the API answers them 403.
 *
 * Here the owner signs this phone in to PayPal, turns card charging on for the store, pairs the
 * reader (PayPal's own screen), and sees recent card payments — refunding one, or settling one the
 * phone never confirmed. The charge itself happens on the checkout sheet (DetailPanel).
 *
 * "Sign out of PayPal" is also how a store changes PayPal accounts (user decision 2026-10-28): it
 * turns card charging off and makes the store forget its saved account (POST
 * /card-payments/disconnect), then signs the phone out. Before that, the saved account could never
 * be cleared, so a phone on a new account was refused for good ("wrong account").
 *
 * owner-web has a read-only twin (settings/card-payments/page.tsx): PayPal's reader can only be
 * driven by its native SDK, so nothing there charges or refunds.
 */
export default function CardPayments() {
  const theme = useTheme();
  const store = useAppState();
  const s = useMemo(() => createStyles(theme), [theme]);
  const available = isCardReaderAvailable();
  const storeCurrency = store.business?.currency ?? null;

  const [settings, setSettings] = useState<CardPaymentSettings | null>(null);
  const [payments, setPayments] = useState<CardPayment[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [account, setAccount] = useState<ReaderAccount | null>(null);
  /** Which action is running, by key — only that button spins. */
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRefund, setConfirmRefund] = useState<CardPayment | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([api.getCardPaymentSettings(), api.listCardPayments({ limit: 50 })]);
      setSettings(st);
      setPayments(list.data);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  const readReader = useCallback(async () => {
    if (!available) return;
    try {
      const ok = await cardReader.isLoggedIn();
      setSignedIn(ok);
      setAccount(ok ? await cardReader.account().catch(() => null) : null);
    } catch {
      setSignedIn(false);
    }
  }, [available]);

  // First load, the same alive-guarded chain the other settings screens use.
  useEffect(() => {
    let alive = true;
    Promise.all([api.getCardPaymentSettings(), api.listCardPayments({ limit: 50 })])
      .then(([st, list]) => {
        if (!alive) return;
        setSettings(st);
        setPayments(list.data);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // PayPal's sign-in happens in a browser tab; when the owner comes back to the app, read again
  // whether this phone is now signed in (Android's login() returns as soon as the tab opens).
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') void readReader();
    });
    const first = setTimeout(() => void readReader(), 0);
    return () => {
      sub.remove();
      clearTimeout(first);
    };
  }, [readReader]);

  // Main owner of a US store only — the same gate as the Settings row and the API.
  if (store.session && (!store.session.isSuperOwner || (store.business && !isUsStore(storeCurrency)))) {
    return <Redirect href="/settings" />;
  }

  /** The account on this phone is not the one the store took payments with — or not in its currency. */
  const accountProblem = (() => {
    if (!account) return null;
    if (account.currency && storeCurrency && account.currency.toUpperCase() !== storeCurrency.toUpperCase()) {
      return format(t.cardPayments.wrongCurrency, { account: account.currency, store: storeCurrency });
    }
    if (settings?.paypalOrgRef && account.orgRef && account.orgRef !== settings.paypalOrgRef) {
      return t.cardPayments.wrongAccount;
    }
    return null;
  })();

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      showToast((e as ApiError)?.message ?? t.toast.error, 'error');
    } finally {
      setBusy(null);
    }
  }

  const signIn = () =>
    run('signIn', async () => {
      await cardReader.login();
      await readReader();
    });

  /**
   * The store lets go first, then the phone. If the store refuses (a charge still unconfirmed, or
   * no connection) the phone stays signed in, so "Check with PayPal" can still settle that charge.
   * If only the phone's sign-out fails, the store is already off and the button is there to retry.
   */
  const signOut = () =>
    run('signOut', async () => {
      try {
        setSettings(await api.disconnectCardPayments());
      } catch (e) {
        if ((e as ApiError)?.code === 'CARD_PAYMENT_IN_PROGRESS') {
          showToast(t.cardPayments.signOutPending, 'error');
          return;
        }
        throw e;
      }
      void store.refresh();
      await cardReader.logout();
      await readReader();
      showToast(t.cardPayments.signedOutDone, 'success');
    });

  /**
   * Losing the store's switch and account deserves a question; a store with neither just signs the
   * phone out. Settings that failed to load could be either, so they ask too.
   */
  const askSignOut = () => {
    if (!settings || settings.enabled || settings.paypalOrgRef) setConfirmSignOut(true);
    else void signOut();
  };

  /** On needs this phone signed in to the store's PayPal account, in the store's currency. */
  const setEnabled = (next: boolean) =>
    run('switch', async () => {
      if (next && (!signedIn || accountProblem)) {
        showToast(accountProblem ?? t.detail.readerSignIn, 'error');
        return;
      }
      const updated = await api.setCardPaymentSettings(next, next ? account?.orgRef ?? null : null);
      setSettings(updated);
      // Every checkout sheet's Card rule follows this; GET /business carries it for Settings.
      void store.refresh();
    });

  /** A charge the phone never confirmed: ask the reader, then record what it says. */
  const check = (p: CardPayment) =>
    run(`check:${p.id}`, async () => {
      const r = await cardReader.retrieve(p.id);
      if (r.status === 'completed') {
        await api.completeCardPayment(p.id, {
          providerPaymentId: r.transactionId ?? null,
          cardBrand: r.cardBrand ?? null,
          cardLast4: r.cardLast4 && /^\d{4}$/.test(r.cardLast4) ? r.cardLast4 : null,
          entryMode: r.entryMode ?? null,
          chargedAmountPaise: r.amountMinor ?? null,
        });
      } else if (r.status === 'not_found' || r.status === 'failed') {
        await api.failCardPayment(p.id, 'Not charged (checked with PayPal)');
      }
      await load();
    });

  const markFailed = (p: CardPayment) =>
    run(`fail:${p.id}`, async () => {
      await api.failCardPayment(p.id, 'Owner: not charged');
      await load();
    });

  const refund = (p: CardPayment) =>
    run(`refund:${p.id}`, async () => {
      try {
        const done = await refundCardPayment(p);
        showToast(format(t.cardPayments.refunded, { amount: formatMoney(done.chargedAmount ?? done.amount) }), 'success');
        await load();
        void store.refresh();
      } catch (e) {
        if (e instanceof RefundError) {
          showToast(
            e.kind === 'canceled'
              ? t.cardPayments.refundCanceled
              : format(t.cardPayments.refundFailed, { reason: e.reason ? ` (${e.reason})` : '' }),
            e.kind === 'canceled' ? 'info' : 'error',
          );
          return;
        }
        throw e;
      }
    });

  const statusLabel: Record<CardPayment['status'], string> = {
    pending: t.cardPayments.statusPending,
    paid: t.cardPayments.statusPaid,
    failed: t.cardPayments.statusFailed,
    refunded: t.cardPayments.statusRefunded,
  };

  const when = (iso: string) =>
    `${dayKeyToLocalDate(storeDayKey(iso)).toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${storeTimeLabel(iso)}`;

  return (
    <SettingsPageShell title={t.cardPayments.title}>
      <TText variant="bodySm" color="textMuted" style={s.lead}>
        {t.cardPayments.lead}
      </TText>
      {cardReaderDevMode ? (
        <View style={s.notice}>
          <TText variant="bodySm" weight="semibold" color="warningSoftFg">
            {t.cardPayments.devMode}
          </TText>
        </View>
      ) : null}

      {!available ? (
        <TText variant="bodySm" color="textMuted" style={s.lead}>
          {t.cardPayments.unavailable}
        </TText>
      ) : (
        <View style={s.card}>
          <TSettingsRow
            icon="creditCard"
            label={signedIn ? t.cardPayments.signedInAs : t.cardPayments.signedOut}
            sub={signedIn ? (account?.name ?? undefined) : undefined}
            trailing={
              <Button
                variant={signedIn ? 'outline' : 'primary'}
                size="sm"
                loading={busy === 'signIn' || busy === 'signOut'}
                disabled={!!busy}
                onPress={signedIn ? askSignOut : signIn}>
                {signedIn ? t.cardPayments.signOut : t.cardPayments.signIn}
              </Button>
            }
          />
          <TSettingsRow
            icon="creditCard"
            label={t.cardPayments.switchLabel}
            sub={t.cardPayments.switchSub}
            subLines={4}
            trailing={
              <TSwitch
                checked={settings?.enabled === true}
                disabled={!settings || busy === 'switch'}
                onChange={(next) => void setEnabled(next)}
              />
            }
          />
          <TSettingsRow
            icon="settings"
            label={t.cardPayments.pairReader}
            sub={t.cardPayments.pairReaderSub}
            onPress={signedIn ? () => void run('reader', () => cardReader.openReaderSettings()) : undefined}
            showBorder={false}
          />
        </View>
      )}
      {accountProblem ? (
        <TText variant="bodySm" color="error" style={s.lead}>
          {accountProblem}
        </TText>
      ) : null}

      <TText variant="caption" color="textSubtle" style={s.sectionTitle}>
        {t.cardPayments.recentTitle}
      </TText>
      {loadFailed ? (
        <TText variant="bodySm" color="textMuted" style={s.lead}>
          {t.cardPayments.loadError}
        </TText>
      ) : payments && payments.length === 0 ? (
        <TText variant="bodySm" color="textMuted" style={s.lead}>
          {t.cardPayments.empty}
        </TText>
      ) : (
        <View style={s.card}>
          {(payments ?? []).map((p, i) => {
            const amount = formatMoney(p.chargedAmount ?? p.amount);
            const card =
              p.cardBrand && p.cardLast4 ? format(t.cardPayments.card, { brand: p.cardBrand, last4: p.cardLast4 }) : null;
            const canAct = available && signedIn;
            return (
              <View key={p.id} style={[s.row, i < (payments?.length ?? 0) - 1 && s.rowBorder]}>
                <View style={s.rowTop}>
                  <View style={s.body}>
                    <TText variant="bodyMd" color="textStrong" weight="semibold" numberOfLines={1}>
                      {`${p.customerName || t.cardPayments.customer} · ${amount}`}
                    </TText>
                    <TText variant="caption" color="textMuted" numberOfLines={2}>
                      {[when(p.createdAt), p.serviceName, card].filter(Boolean).join(' · ')}
                    </TText>
                  </View>
                  <View style={[s.badge, (p.needsReview || p.status === 'pending') && s.badgeWarn]}>
                    <TText variant="caption" weight="bold" color={p.needsReview || p.status === 'pending' ? 'warningSoftFg' : 'textMuted'}>
                      {p.needsReview ? t.cardPayments.needsReview : statusLabel[p.status]}
                    </TText>
                  </View>
                </View>
                {p.needsReview ? (
                  <TText variant="caption" color="textMuted">
                    {t.cardPayments.needsReviewHint}
                  </TText>
                ) : p.status === 'pending' ? (
                  <TText variant="caption" color="textMuted">
                    {t.cardPayments.pendingHint}
                  </TText>
                ) : null}
                {canAct && p.status === 'pending' ? (
                  <View style={s.actions}>
                    <Button size="sm" variant="primary" loading={busy === `check:${p.id}`} disabled={!!busy} onPress={() => void check(p)}>
                      {t.cardPayments.check}
                    </Button>
                    <Button size="sm" variant="outline" loading={busy === `fail:${p.id}`} disabled={!!busy} onPress={() => void markFailed(p)}>
                      {t.cardPayments.markFailed}
                    </Button>
                  </View>
                ) : null}
                {canAct && p.status === 'paid' ? (
                  <View style={s.actions}>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy === `refund:${p.id}`}
                      disabled={!!busy}
                      onPress={() => setConfirmRefund(p)}>
                      {format(t.cardPayments.refund, { amount })}
                    </Button>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {confirmRefund ? (
        <ConfirmSheet
          visible
          destructive
          title={format(t.cardPayments.refundTitle, { amount: formatMoney(confirmRefund.chargedAmount ?? confirmRefund.amount) })}
          body={t.cardPayments.refundBody}
          confirmLabel={t.cardPayments.refundConfirm}
          onConfirm={() => {
            const p = confirmRefund;
            setConfirmRefund(null);
            void refund(p);
          }}
          onCancel={() => setConfirmRefund(null)}
        />
      ) : null}

      {confirmSignOut ? (
        <ConfirmSheet
          visible
          destructive
          title={t.cardPayments.signOutTitle}
          body={t.cardPayments.signOutBody}
          confirmLabel={t.cardPayments.signOutConfirm}
          onConfirm={() => {
            setConfirmSignOut(false);
            void signOut();
          }}
          onCancel={() => setConfirmSignOut(false)}
        />
      ) : null}
    </SettingsPageShell>
  );
}

const createStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    lead: { ...styles.mb3, ...styles.mh1 },
    sectionTitle: { ...styles.mt4, ...styles.mb2, ...styles.mh1, textTransform: 'uppercase' },
    notice: {
      ...styles.mb3,
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(9),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.warningSoft,
    },
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
    },
    row: { ...styles.ph4, paddingVertical: moderateScale(12), gap: moderateScale(6) },
    rowBorder: { borderBottomWidth: moderateScale(1), borderBottomColor: colors.borderSubtle },
    rowTop: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g3 },
    body: { ...styles.flex, ...styles.minWidth0, gap: moderateScale(2) },
    badge: {
      paddingHorizontal: moderateScale(8),
      paddingVertical: moderateScale(2),
      borderRadius: moderateScale(radius.pill),
      backgroundColor: colors.surfacePage,
    },
    badgeWarn: { backgroundColor: colors.warningSoft },
    actions: { ...styles.flexRow, ...styles.wrap, ...styles.g2, marginTop: moderateScale(4) },
  });
