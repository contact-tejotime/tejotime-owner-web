import { Redirect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TButton, TInput, TLoader, TText } from '@/components/common';
import { ConfirmSheet } from '@/components/feedback/ConfirmSheet';
import { SettingsPageShell } from '@/components/settings';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import {
  Access,
  GRANTABLE_MODULES,
  isOwnerRole,
  PermissionModule,
  toPermissionPayload,
} from '@/lib/permissions';
import { showToast } from '@/lib/toast';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Team logins — the app's twin of owner-web's /settings/team.
 *
 * Three rules this screen exists to make obvious, all of which the backend enforces
 * independently (backend/src/modules/users/users.service.ts):
 *   - the super owner account cannot be edited or removed from here (it is the admin panel's),
 *   - a co-owner has the same access as the owner, so there is nothing to configure for one,
 *   - a staff login sees only the modules ticked here, and inside them only its own chair.
 *
 * Reads live rather than through the store: this list is small, opened rarely, and only by the
 * one person editing it — caching it would mostly serve to show a login they just removed.
 */

const ACCESS_LABELS: Record<Access, string> = {
  none: t.team.accessNone,
  view: t.team.accessView,
  manage: t.team.accessManage,
};

const MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard: t.team.moduleDashboard,
  queue: t.team.moduleQueue,
  appointments: t.team.moduleAppointments,
  calendar: t.team.moduleCalendar,
  customers: t.team.moduleCustomers,
  services: t.team.moduleServices,
  staff: t.team.moduleStaff,
  hours: t.team.moduleHours,
  notifications: t.team.moduleNotifications,
  billing: t.team.moduleBilling,
  profile: t.team.moduleProfile,
  team: t.team.moduleTeam,
};

interface TeamUser {
  id: string;
  name: string | null;
  phone: string | null;
  role: 'owner' | 'co_owner' | 'manager' | 'staff';
  isSuperOwner: boolean;
  isActive: boolean;
  staffId: string | null;
  staffName: string | null;
  permissions: Record<PermissionModule, Access>;
}

type Draft = {
  name: string;
  phone: string;
  password: string;
  role: 'co_owner' | 'staff';
  staffId: string | null;
  permissions: Partial<Record<PermissionModule, Access>>;
};

/** The two reads this screen needs. Pure — the callers decide what to do with the result. */
async function fetchTeam() {
  const [list, catalogue] = await Promise.all([api.getTeam(), api.getPermissionCatalogue()]);
  return {
    users: (list?.data ?? []) as TeamUser[],
    defaults: (catalogue?.defaults?.staff ?? {}) as Partial<Record<PermissionModule, Access>>,
  };
}

export default function TeamLogins() {
  const theme = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const { session, staff } = useAppState();

  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [defaults, setDefaults] = useState<Partial<Record<PermissionModule, Access>>>({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Which custom dialog is open. Replaces Alert.alert / Alert.prompt — see ConfirmSheet. */
  const [dialog, setDialog] = useState<{ kind: 'deactivate' | 'password'; user: TeamUser } | null>(
    null,
  );
  const [permDraft, setPermDraft] = useState<Partial<Record<PermissionModule, Access>>>({});

  /**
   * Load on mount.
   *
   * The fetch lives inline rather than in a `useCallback` the effect calls: the state updates
   * have to sit in a promise continuation, not in the effect body, or they cascade a second
   * render before the first has painted. `mounted` guards every write, because an owner who
   * taps back mid-flight would otherwise set state on an unmounted screen.
   */
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchTeam();
        if (!mounted) return;
        setUsers(data.users);
        setDefaults(data.defaults);
      } catch (e) {
        if (!mounted) return;
        showToast((e as ApiError)?.message ?? t.team.title, 'error');
        setUsers([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /** Re-read after a mutation. Same two calls, but this one is allowed to be imperative. */
  const reload = useCallback(async () => {
    const data = await fetchTeam();
    setUsers(data.users);
    setDefaults(data.defaults);
  }, []);

  // Gated on the ROLE, not a permission — matching the backend, where "can create logins" is
  // the one thing an owner cannot delegate, because whoever holds it can grant themselves
  // every other permission.
  if (session && !isOwnerRole(session.role)) return <Redirect href="/settings" />;

  const linkedSeatIds = new Set((users ?? []).map((u) => u.staffId).filter(Boolean) as string[]);
  const freeSeats = staff.filter((seat) => !linkedSeatIds.has(seat.id));

  const run = async (fn: () => Promise<unknown>, successMessage?: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      if (successMessage) showToast(successMessage, 'success');
      return true;
    } catch (e) {
      showToast((e as ApiError)?.message ?? t.team.title, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startAdd = (role: 'co_owner' | 'staff') => {
    if (role === 'staff' && freeSeats.length === 0) {
      showToast(t.team.noFreeChairs, 'error');
      return;
    }
    setEditingId(null);
    setAdding(true);
    // Pre-fill from the role's own defaults so the owner adjusts a sensible starting point
    // rather than ticking eleven rows from nothing. Staff must pick a chair.
    setDraft({
      name: '',
      phone: '',
      password: '',
      role,
      staffId: role === 'staff' ? (freeSeats[0]?.id ?? null) : null,
      permissions: role === 'staff' ? { ...defaults } : {},
    });
  };

  const onCreate = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return showToast(t.team.name, 'error');
    if (draft.phone.replace(/\D/g, '').length < 10) return showToast(t.team.phoneHint, 'error');
    if (draft.password.length < 8) return showToast(t.password.tooShort, 'error');
    if (draft.role === 'staff' && !draft.staffId) {
      return showToast(t.team.chairRequired, 'error');
    }

    const ok = await run(
      () =>
        api.createUser({
          name: draft.name.trim(),
          phone: draft.phone.replace(/\D/g, ''),
          password: draft.password,
          role: draft.role,
          staffId: draft.role === 'staff' ? draft.staffId : null,
          ...(draft.role === 'staff' ? { permissions: toPermissionPayload(draft.permissions) } : {}),
        }),
      t.team.createdToast,
    );
    if (ok) {
      setAdding(false);
      setDraft(null);
    }
  };

  const onSavePermissions = async (userId: string) => {
    // The full grantable map goes up every time: the backend replaces the override set
    // wholesale, so a module reset to its default vanishes instead of lingering as a stale row.
    const ok = await run(
      () => api.setUserPermissions(userId, toPermissionPayload(permDraft)),
      t.team.permissionsSavedToast,
    );
    if (ok) setEditingId(null);
  };

  /**
   * Move a staff login's chair. Unlinking is not allowed — each staff login needs a chair.
   */
  const onChangeSeat = (user: TeamUser, staffId: string) =>
    run(() => api.updateUser(user.id, { staffId }), t.team.chairLinkedToast);

  const onToggleActive = (user: TeamUser) => {
    if (!user.isActive) {
      return run(() => api.updateUser(user.id, { isActive: true }));
    }
    setDialog({ kind: 'deactivate', user });
  };

  const onResetPassword = (user: TeamUser) => setDialog({ kind: 'password', user });

  /** Runs whichever dialog is open, so both paths close and report the same way. */
  const onDialogConfirm = async (value: string) => {
    if (!dialog) return;
    const ok =
      dialog.kind === 'deactivate'
        ? await run(() => api.deactivateUser(dialog.user.id))
        : await run(() => api.resetUserPassword(dialog.user.id, value), t.team.passwordResetToast);
    if (ok) setDialog(null);
  };

  const summarise = (permissions: Record<PermissionModule, Access>) => {
    const visible = GRANTABLE_MODULES.filter((m) => permissions?.[m] && permissions[m] !== 'none');
    if (visible.length === 0) return t.team.canSeeNothing;
    return t.team.canSee.replace('{list}', visible.map((m) => MODULE_LABELS[m]).join(', '));
  };

  if (users === null) {
    return (
      <SettingsPageShell title={t.team.title}>
        <View style={s.loading}>
          <TLoader />
        </View>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title={t.team.title}>
      <View style={s.page}>
        <TText variant="bodySm" color="textMuted">
          {t.team.subtitle}
        </TText>

        {users.map((user) => {
          const isSelf = user.id === session?.id;
          const locked = user.isSuperOwner || isSelf;
          const seatChoices = staff.filter(
            (seat) => seat.id === user.staffId || !linkedSeatIds.has(seat.id),
          );

          return (
            <View key={user.id} style={[s.card, !user.isActive && s.cardInactive]}>
              <View style={s.cardTop}>
                <View style={styles.flex}>
                  <View style={s.nameRow}>
                    <TText variant="bodyMd" color="textStrong" weight="semibold">
                      {user.name ?? '—'}
                    </TText>
                    {user.isSuperOwner ? <Badge label={t.team.ownerAccount} tone="primary" /> : null}
                    {isSelf && !user.isSuperOwner ? <Badge label={t.team.you} tone="primary" /> : null}
                    {!user.isActive ? <Badge label={t.team.turnedOff} tone="muted" /> : null}
                    {user.role === 'staff' && user.isActive && !user.staffId ? (
                      <Badge label={t.team.noChair} tone="warn" />
                    ) : null}
                  </View>
                  <TText variant="caption" color="textMuted" style={styles.mt1}>
                    {[
                      user.role === 'staff' ? t.team.staff : t.team.coOwner,
                      user.staffName,
                      user.phone,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </TText>
                </View>
              </View>

              {user.role === 'staff' && !locked ? (
                <View style={s.seatBlock}>
                  <TText variant="caption" color="textBody" weight="semibold">
                    {t.team.chair}
                  </TText>
                  <View style={s.chipRow}>
                    {seatChoices.map((seat) => (
                      <Chip
                        key={seat.id}
                        label={seat.name}
                        active={user.staffId === seat.id}
                        disabled={busy}
                        onPress={() => onChangeSeat(user, seat.id)}
                      />
                    ))}
                  </View>
                  {!user.staffId ? (
                    <TText variant="caption" style={{ color: theme.colors.warningSoftFg }}>
                      {t.team.noChairWarn}
                    </TText>
                  ) : null}
                </View>
              ) : null}

              {user.role === 'staff' ? (
                editingId === user.id ? (
                  <View style={s.permBlock}>
                    <PermissionGrid value={permDraft} onChange={setPermDraft} disabled={busy} />
                    <View style={s.actionRow}>
                      <TButton
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onPress={() => onSavePermissions(user.id)}
                      >
                        {t.team.savePermissions}
                      </TButton>
                      <TButton variant="secondary" size="sm" onPress={() => setEditingId(null)}>
                        {t.team.cancel}
                      </TButton>
                    </View>
                  </View>
                ) : (
                  <TText variant="caption" color="textBody" style={styles.mt2}>
                    {summarise(user.permissions)}
                  </TText>
                )
              ) : (
                <TText variant="caption" color="textBody" style={styles.mt2}>
                  {user.isSuperOwner ? t.team.fullAccessSuper : t.team.fullAccessCo}
                </TText>
              )}

              {!locked ? (
                <View style={s.actionRow}>
                  {user.role === 'staff' && editingId !== user.id ? (
                    <TButton
                      variant="secondary"
                      size="sm"
                      onPress={() => {
                        setAdding(false);
                        setEditingId(user.id);
                        setPermDraft({ ...user.permissions });
                      }}
                    >
                      {t.team.permissions}
                    </TButton>
                  ) : null}
                  <TButton variant="secondary" size="sm" onPress={() => onResetPassword(user)}>
                    {t.team.resetPassword}
                  </TButton>
                  <TButton variant="secondary" size="sm" onPress={() => onToggleActive(user)}>
                    {user.isActive ? t.team.turnOff : t.team.turnOn}
                  </TButton>
                </View>
              ) : null}
            </View>
          );
        })}

        {adding && draft ? (
          <View style={s.card}>
            <TText variant="bodyMd" color="textStrong" weight="semibold">
              {t.team.addTitle}
            </TText>

            <View style={s.roleRow}>
              {(['staff', 'co_owner'] as const).map((role) => (
                <Pressable
                  key={role}
                  onPress={() =>
                    setDraft({
                      ...draft,
                      role,
                      staffId:
                        role === 'staff' ? draft.staffId ?? freeSeats[0]?.id ?? null : null,
                      permissions: role === 'staff' ? { ...defaults } : {},
                    })
                  }
                  style={[
                    s.roleBtn,
                    { borderColor: theme.colors.borderDefault },
                    draft.role === role && {
                      borderColor: theme.colors.primary,
                      backgroundColor: theme.colors.primarySoft,
                    },
                  ]}
                >
                  <TText variant="bodySm" color="textStrong" weight="semibold">
                    {role === 'staff' ? t.team.staff : t.team.coOwner}
                  </TText>
                  <TText variant="caption" color="textMuted" style={styles.mt1}>
                    {role === 'staff' ? t.team.staffBlurb : t.team.coOwnerBlurb}
                  </TText>
                </Pressable>
              ))}
            </View>

            <TInput
              label={t.team.name}
              value={draft.name}
              onChangeText={(name) => setDraft({ ...draft, name })}
              editable={!busy}
            />
            <View>
              <TInput
                label={t.team.phone}
                keyboardType="phone-pad"
                value={draft.phone}
                onChangeText={(phone) => setDraft({ ...draft, phone })}
                editable={!busy}
              />
              <TText variant="caption" color="textMuted" style={styles.mt1}>
                {t.team.phoneHint}
              </TText>
            </View>
            <View>
              <TInput
                label={t.team.tempPassword}
                value={draft.password}
                onChangeText={(password) => setDraft({ ...draft, password })}
                editable={!busy}
              />
              <TText variant="caption" color="textMuted" style={styles.mt1}>
                {t.team.tempPasswordHint}
              </TText>
            </View>

            {draft.role === 'staff' ? (
              <>
                <View>
                  <TText variant="caption" color="textBody" weight="semibold">
                    {t.team.chairRequiredLabel}
                  </TText>
                  <View style={s.chipRow}>
                    {freeSeats.map((seat) => (
                      <Chip
                        key={seat.id}
                        label={seat.name}
                        active={draft.staffId === seat.id}
                        disabled={busy}
                        onPress={() => setDraft({ ...draft, staffId: seat.id })}
                      />
                    ))}
                  </View>
                  <TText variant="caption" color="textMuted" style={styles.mt1}>
                    {t.team.chairHint}
                  </TText>
                </View>

                <View>
                  <TText variant="caption" color="textBody" weight="semibold">
                    {t.team.whatTheySee}
                  </TText>
                  <PermissionGrid
                    value={draft.permissions}
                    onChange={(permissions) => setDraft({ ...draft, permissions })}
                    disabled={busy}
                  />
                </View>
              </>
            ) : (
              <TText variant="caption" color="textMuted">
                {t.team.coOwnerNote}
              </TText>
            )}

            <View style={s.actionRow}>
              <TButton variant="primary" size="sm" loading={busy} onPress={onCreate}>
                {t.team.create}
              </TButton>
              <TButton
                variant="secondary"
                size="sm"
                onPress={() => {
                  setAdding(false);
                  setDraft(null);
                }}
              >
                {t.team.cancel}
              </TButton>
            </View>
          </View>
        ) : (
          <>
            <View style={s.actionRow}>
              <TButton
                variant="primary"
                size="md"
                onPress={() => startAdd('staff')}
                disabled={freeSeats.length === 0}
              >
                {t.team.addStaff}
              </TButton>
              <TButton variant="secondary" size="md" onPress={() => startAdd('co_owner')}>
                {t.team.addCoOwner}
              </TButton>
            </View>
            {freeSeats.length === 0 ? (
              <TText variant="caption" color="textMuted">
                {t.team.noFreeChairs}
              </TText>
            ) : null}
          </>
        )}
      </View>

      <ConfirmSheet
        // Keyed per opening so each mounts fresh — otherwise the next reset would inherit the
        // last dialog's typed password.
        key={dialog ? `${dialog.kind}:${dialog.user.id}` : 'none'}
        visible={!!dialog}
        title={dialog?.kind === 'password' ? t.team.resetPassword : t.team.turnOff}
        body={
          dialog?.kind === 'password'
            ? t.password.hint
            : t.team.turnOffConfirm.replace('{name}', dialog?.user.name ?? '')
        }
        confirmLabel={dialog?.kind === 'password' ? t.team.resetPassword : t.team.turnOff}
        destructive={dialog?.kind === 'deactivate'}
        input={
          dialog?.kind === 'password'
            ? { label: t.password.new, hint: t.password.hint, minLength: 8 }
            : undefined
        }
        busy={busy}
        onConfirm={onDialogConfirm}
        onCancel={() => setDialog(null)}
      />
    </SettingsPageShell>
  );
}

function Badge({ label, tone }: { label: string; tone: 'primary' | 'muted' | 'warn' }) {
  const { colors } = useTheme();
  const bg =
    tone === 'warn' ? colors.warningSoft : tone === 'muted' ? colors.surfaceHover : colors.primarySoft;
  const fg =
    tone === 'warn' ? colors.warningSoftFg : tone === 'muted' ? colors.textMuted : colors.primary;
  return (
    <View style={[badgeStyles.badge, { backgroundColor: bg }]}>
      <TText variant="caption" weight="bold" style={{ color: fg }}>
        {label}
      </TText>
    </View>
  );
}

function Chip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        badgeStyles.chip,
        { borderColor: colors.borderDefault, backgroundColor: colors.surfaceCard },
        active && { borderColor: colors.primary, backgroundColor: colors.primary },
      ]}
    >
      <TText variant="caption" weight="semibold" style={{ color: active ? '#fff' : colors.textMuted }}>
        {label}
      </TText>
    </Pressable>
  );
}

function PermissionGrid({
  value,
  onChange,
  disabled,
}: {
  value: Partial<Record<PermissionModule, Access>>;
  onChange: (next: Partial<Record<PermissionModule, Access>>) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={badgeStyles.grid}>
      {GRANTABLE_MODULES.map((mod) => (
        <View key={mod} style={[badgeStyles.gridRow, { borderBottomColor: colors.borderSubtle }]}>
          <TText variant="caption" color="textBody" weight="semibold">
            {MODULE_LABELS[mod]}
          </TText>
          <View style={badgeStyles.gridOptions}>
            {(['none', 'view', 'manage'] as Access[]).map((level) => (
              <Chip
                key={level}
                label={ACCESS_LABELS[level]}
                active={(value[mod] ?? 'none') === level}
                disabled={disabled}
                onPress={() => onChange({ ...value, [mod]: level })}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: {
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(2),
    borderRadius: moderateScale(999),
  },
  chip: {
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(5),
    borderWidth: moderateScale(1),
    borderRadius: moderateScale(999),
  },
  grid: { ...styles.g2, marginTop: moderateScale(8) },
  gridRow: {
    ...styles.g2,
    paddingBottom: moderateScale(8),
    borderBottomWidth: moderateScale(1),
  },
  gridOptions: { ...styles.flexRow, gap: moderateScale(6), flexWrap: 'wrap' },
});

const createStyles = ({ colors }: ThemeStyleProps) =>
  StyleSheet.create({
    page: {
      ...styles.g4,
      paddingHorizontal: moderateScale(12),
      paddingBottom: moderateScale(28),
    },
    loading: { ...styles.itemsCenter, ...styles.justifyCenter, paddingVertical: moderateScale(48) },
    card: {
      ...styles.g2,
      padding: moderateScale(14),
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(12),
      backgroundColor: colors.surfaceCard,
    },
    cardInactive: { opacity: 0.6 },
    cardTop: { ...styles.flexRow, ...styles.itemsStart, gap: moderateScale(10) },
    nameRow: { ...styles.flexRow, ...styles.itemsCenter, gap: moderateScale(6), flexWrap: 'wrap' },
    seatBlock: {
      ...styles.g2,
      marginTop: moderateScale(10),
      paddingTop: moderateScale(10),
      borderTopWidth: moderateScale(1),
      borderTopColor: colors.borderSubtle,
    },
    permBlock: {
      marginTop: moderateScale(10),
      paddingTop: moderateScale(10),
      borderTopWidth: moderateScale(1),
      borderTopColor: colors.borderSubtle,
    },
    chipRow: { ...styles.flexRow, gap: moderateScale(6), flexWrap: 'wrap' },
    actionRow: { ...styles.flexRow, gap: moderateScale(8), flexWrap: 'wrap', marginTop: moderateScale(10) },
    roleRow: { ...styles.g2, marginTop: moderateScale(4) },
    roleBtn: {
      padding: moderateScale(12),
      borderWidth: moderateScale(1),
      borderRadius: moderateScale(10),
    },
  });
