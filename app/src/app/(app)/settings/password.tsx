import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TButton, TInput, TText } from '@/components/common';
import { SettingsPageShell } from '@/components/settings';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Change your own password.
 *
 * Every login except the super owner's is created by somebody else, who therefore knows its
 * initial password — so this is the first thing a new co-owner or staff member should do. The
 * current password is required, so a borrowed unlocked phone cannot lock the real owner out.
 */
export default function ChangePassword() {
  const theme = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (next.length < 8) return showToast(t.password.tooShort, 'error');
    if (next !== confirm) return showToast(t.password.mismatch, 'error');
    setBusy(true);
    try {
      await api.changePassword(current, next);
      showToast(t.password.changed, 'success');
      router.back();
    } catch (e) {
      showToast((e as ApiError)?.message ?? t.password.title, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPageShell title={t.password.title}>
      <View style={s.form}>
        <TInput
          label={t.password.current}
          secureTextEntry
          value={current}
          onChangeText={setCurrent}
          editable={!busy}
        />
        <View>
          <TInput
            label={t.password.new}
            secureTextEntry
            value={next}
            onChangeText={setNext}
            editable={!busy}
          />
          <TText variant="caption" color="textMuted" style={styles.mt1}>
            {t.password.hint}
          </TText>
        </View>
        <TInput
          label={t.password.confirm}
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
          editable={!busy}
        />
        <TButton variant="primary" size="lg" fullWidth loading={busy} onPress={onSubmit}>
          {t.password.submit}
        </TButton>
      </View>
    </SettingsPageShell>
  );
}

const createStyles = (_theme: ThemeStyleProps) =>
  StyleSheet.create({
    form: { ...styles.g4, paddingHorizontal: moderateScale(12), paddingBottom: moderateScale(24) },
  });
