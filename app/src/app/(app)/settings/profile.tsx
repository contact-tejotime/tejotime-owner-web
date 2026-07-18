import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TButton, TInput, TSettingsRow } from '@/components/common';
import { SettingsPageShell } from '@/components/settings';
import { t } from '@/i18n';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

export default function BusinessProfile() {
  const store = useAppState();
  return (
    <SettingsPageShell title={t.profile.title}>
      {/* Keyed on the business id so the form re-seeds if the business loads after mount. */}
      <ProfileForm key={store.business?.id ?? 'pending'} />
    </SettingsPageShell>
  );
}

function ProfileForm() {
  const theme = useTheme();
  const store = useAppState();
  const biz = store.business;
  const s = useMemo(() => createProfileStyles(theme), [theme]);
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
      <TInput label={t.profile.nameLabel} value={name} onChangeText={setName} />
      <TInput
        label={t.profile.phoneLabel}
        prefix={`+${biz?.countryCode ?? '91'}`}
        value={biz?.phoneNumber ?? ''}
        disabled
      />
      <TInput label={t.profile.addressLabel} value={address} onChangeText={setAddress} />
      <View style={s.card}>
        <TSettingsRow
          icon="qrCode"
          label={t.profile.contactQr}
          sub={t.profile.contactSub}
          showBorder={false}
          onPress={store.openQr}
        />
      </View>
      <TButton variant="primary" size="lg" fullWidth loading={saving} onPress={save}>
        {t.profile.save}
      </TButton>
    </View>
  );
}

const createProfileStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    form: { ...styles.g4, ...styles.pt1 },
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
    },
  });
