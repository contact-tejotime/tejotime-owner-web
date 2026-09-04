import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TButton, TInput, TSettingsRow, TText } from '@/components/common';
import { OwnerStoreProfileForm } from '@/components/settings/OwnerStoreProfileForm';
import { SettingsPageShell } from '@/components/settings';
import { t } from '@/i18n';
import { isOwnerRole } from '@/lib/permissions';
import { DEFAULT_DIAL_CODE } from '@/lib/phone';
import { useAppState } from '@/state/store';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

export default function BusinessProfile() {
  const store = useAppState();
  const role = store.session?.role ?? null;
  const owner = isOwnerRole(role);

  return (
    <SettingsPageShell title={t.profile.title}>
      {owner ? (
        <OwnerStoreProfileForm key={store.business?.id ?? 'pending'} />
      ) : (
        <StaffProfileForm key={store.business?.id ?? 'pending'} />
      )}
    </SettingsPageShell>
  );
}

/** Staff keep the short name + address form — public shopfront fields stay owner-only. */
function StaffProfileForm() {
  const theme = useTheme();
  const store = useAppState();
  const biz = store.business;
  const s = useMemo(() => createStaffStyles(theme), [theme]);
  const [name, setName] = useState(biz?.name ?? '');
  const [address, setAddress] = useState(biz?.address ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const ok = await store.saveProfile({ name: name.trim(), address: address.trim() });
    setSaving(false);
    if (ok) router.back();
  };

  return (
    <View style={s.form}>
      <View style={s.section}>
        <TText variant="bodySm" color="textStrong" weight="bold" style={s.sectionTitle}>
          {t.profile.sectionBasics}
        </TText>
        <View style={s.card}>
          <View style={s.cardBody}>
            <TInput label={t.profile.nameLabel} value={name} onChangeText={setName} />
            <TInput
              label={t.profile.phoneLabel}
              prefix={`+${biz?.countryCode ?? DEFAULT_DIAL_CODE}`}
              value={biz?.phoneNumber ?? ''}
              disabled
            />
            <TInput label={t.profile.addressLabel} value={address} onChangeText={setAddress} />
          </View>
        </View>
      </View>

      <View style={s.section}>
        <TText variant="bodySm" color="textStrong" weight="bold" style={s.sectionTitle}>
          {t.profile.contactQr}
        </TText>
        <View style={s.card}>
          <TSettingsRow
            icon="qrCode"
            label={t.profile.contactQr}
            sub={t.profile.contactSub}
            showBorder={false}
            onPress={store.openQr}
          />
        </View>
      </View>

      <TButton variant="primary" size="lg" fullWidth loading={saving} onPress={save}>
        {t.profile.save}
      </TButton>
    </View>
  );
}

const createStaffStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    form: { paddingTop: moderateScale(4), paddingBottom: moderateScale(28) },
    section: { marginBottom: moderateScale(22) },
    sectionTitle: { marginBottom: moderateScale(6), marginLeft: moderateScale(2) },
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
    },
    cardBody: {
      padding: moderateScale(16),
      gap: moderateScale(16),
    },
  });
