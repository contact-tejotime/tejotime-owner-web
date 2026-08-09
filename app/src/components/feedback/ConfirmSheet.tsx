import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { TButton, TText } from '@/components/common';
import { t } from '@/i18n';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Our own confirm / prompt, replacing `Alert.alert` and `Alert.prompt`.
 *
 * `Alert.prompt` is **iOS only**. On Android it is undefined, so the guarded call we had
 * (`Alert.prompt?.(...)`) silently did nothing — "Reset password" on the team screen appeared to
 * work and never asked for anything. That is the kind of bug that only shows up on the platform
 * you are not holding.
 *
 * `Alert.alert` works on both, but it is OS chrome: it cannot be styled, it does not match the
 * portal's version of the same dialog, and it cannot validate what is typed.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  destructive = false,
  /** Show a text field and hand its value to onConfirm. Used for setting a password. */
  input,
  busy = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  input?: { label: string; hint?: string; minLength?: number };
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const s = createStyles(theme);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const confirm = () => {
    if (input?.minLength && value.length < input.minLength) {
      setError(t.password.tooShort);
      return;
    }
    onConfirm(value);
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.backdrop} onPress={onCancel}>
        {/* Swallow taps inside the card so only the backdrop dismisses. */}
        <Pressable style={s.card} onPress={() => {}}>
          <TText variant="h5" color="textStrong" weight="bold">
            {title}
          </TText>
          {body ? (
            <TText variant="bodySm" color="textMuted" style={styles.mt2}>
              {body}
            </TText>
          ) : null}

          {input ? (
            <View style={styles.mt3}>
              <TText variant="caption" color="textBody" weight="semibold">
                {input.label}
              </TText>
              <TextInput
                style={s.input}
                value={value}
                onChangeText={(v) => {
                  setValue(v);
                  setError('');
                }}
                autoFocus
                accessibilityLabel={input.label}
              />
              {input.hint ? (
                <TText variant="caption" color="textMuted" style={styles.mt1}>
                  {input.hint}
                </TText>
              ) : null}
            </View>
          ) : null}

          {error ? (
            <TText variant="caption" style={[styles.mt2, { color: theme.colors.error }]}>
              {error}
            </TText>
          ) : null}

          <View style={s.actions}>
            <TButton
              variant={destructive ? 'danger' : 'primary'}
              fullWidth
              loading={busy}
              onPress={confirm}>
              {confirmLabel}
            </TButton>
            <TButton variant="outline" fullWidth disabled={busy} onPress={onCancel}>
              {t.team.cancel}
            </TButton>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    backdrop: {
      ...styles.flex,
      ...styles.itemsCenter,
      ...styles.justifyCenter,
      backgroundColor: 'rgba(15, 23, 42, 0.45)',
      padding: moderateScale(20),
    },
    card: {
      width: '100%',
      maxWidth: moderateScale(420),
      padding: moderateScale(18),
      borderRadius: moderateScale(radius.lg),
      backgroundColor: colors.surfaceCard,
    },
    input: {
      marginTop: moderateScale(6),
      paddingHorizontal: moderateScale(12),
      paddingVertical: moderateScale(10),
      borderWidth: moderateScale(1),
      borderColor: colors.borderDefault,
      borderRadius: moderateScale(radius.md),
      color: colors.textStrong,
      fontSize: moderateScale(15),
    },
    actions: { gap: moderateScale(8), marginTop: moderateScale(18) },
  });
