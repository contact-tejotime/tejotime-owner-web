import React, { useState } from 'react';
import { KeyboardTypeOptions, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { TButton, TKeyboardScreen, TText } from '@/components/common';
import { t } from '@/i18n';
import { styles } from '@/styles';
import { MAX_FONT_SCALE, moderateScale } from '@/styles/scale';
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
 *
 * `presentation="overlay"` draws the same card as an absolute layer instead of its own Modal, for
 * a prompt opened INSIDE another Modal — iOS will not present a second Modal over an open one, so
 * a Modal-based prompt there never appears (the checkout sheet's add-on price, DetailPanel). The
 * caller then mounts it per opening (`key`), since an overlay that stays mounted keeps its text.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  destructive = false,
  /**
   * Show a text field and hand its value to onConfirm. Used for setting a password, and for an
   * add-on's price (`prefix` = the store's currency symbol, `validate` returns the message to show
   * instead of confirming).
   */
  input,
  busy = false,
  presentation = 'modal',
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  input?: {
    label: string;
    hint?: string;
    minLength?: number;
    prefix?: string;
    keyboardType?: KeyboardTypeOptions;
    validate?: (value: string) => string | null;
  };
  busy?: boolean;
  presentation?: 'modal' | 'overlay';
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
    const invalid = input?.validate?.(value);
    if (invalid) {
      setError(invalid);
      return;
    }
    onConfirm(value);
  };

  const field = input ? (
    <TextInput
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={input.prefix ? s.prefixedInput : s.input}
      value={value}
      onChangeText={(v) => {
        setValue(v);
        setError('');
      }}
      keyboardType={input.keyboardType}
      onSubmitEditing={confirm}
      autoFocus
      accessibilityLabel={input.label}
    />
  ) : null;

  const content = (
    /* The prompt variant (Team -> reset password) centres a card that is ~300pt tall. iOS
       floats the keyboard over it, which buried Confirm and Cancel; Android's resize mode
       re-centred them. Avoid the keyboard so the buttons stay on screen on both. */
    <TKeyboardScreen isScrollView={false}>
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
              {input.prefix ? (
                <View style={s.prefixRow}>
                  <TText variant="bodyMd" color="textMuted" weight="bold">
                    {input.prefix}
                  </TText>
                  {field}
                </View>
              ) : (
                field
              )}
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
    </TKeyboardScreen>
  );

  if (presentation === 'overlay') {
    return visible ? <View style={StyleSheet.absoluteFill}>{content}</View> : null;
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      {content}
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
    // A field with a prefix (the add-on price's currency symbol): the row draws the box, the
    // input inside it is bare.
    prefixRow: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(6),
      marginTop: moderateScale(6),
      paddingHorizontal: moderateScale(12),
      borderWidth: moderateScale(1),
      borderColor: colors.borderDefault,
      borderRadius: moderateScale(radius.md),
    },
    prefixedInput: {
      ...styles.flex,
      paddingVertical: moderateScale(10),
      color: colors.textStrong,
      fontSize: moderateScale(15),
    },
    actions: { gap: moderateScale(8), marginTop: moderateScale(18) },
  });
