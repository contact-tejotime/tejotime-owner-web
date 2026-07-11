import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, TextStyle, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TText } from '@/components/common/TText';
import { Icon } from '@/components/ui/Icon';
import { flagEmoji, searchCountries, type Country } from '@/lib/phone';
import { styles } from '@/styles';
import { moderateScale, rSize, scaleFont } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  label?: string;
  error?: string;
  hint?: string;
  dialCode: string;
  iso2: string;
  national: string;
  onChangeCountry: (c: { dialCode: string; iso2: string }) => void;
  onChangeNational: (v: string) => void;
  editable?: boolean;
  placeholder?: string;
  containerStyle?: TextStyle;
};

/**
 * Country-code picker (searchable modal) + national-number field. Mirrors
 * TInput's look. Parent keeps { dialCode, iso2, national }; combine dialCode +
 * national into the stored phone (E.164 for customers, digits for logins).
 */
export function PhoneInput({
  label,
  error,
  hint,
  dialCode,
  iso2,
  national,
  onChangeCountry,
  onChangeNational,
  editable = true,
  placeholder = 'Phone number',
  containerStyle,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [focus, setFocus] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const borderColor = error ? theme.colors.error : focus ? theme.colors.borderFocus : theme.colors.borderDefault;
  const s = useMemo(() => createPhoneInputStyles(theme, borderColor, insets.bottom), [theme, borderColor, insets.bottom]);
  const results = useMemo(() => searchCountries(query), [query]);

  function pick(c: Country) {
    onChangeCountry({ dialCode: c.dialCode, iso2: c.iso2 });
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={[s.root, containerStyle]}>
      {label && (
        <TText variant="bodySm" color="textBody" weight="medium">
          {label}
        </TText>
      )}
      <View style={s.field}>
        <Pressable
          onPress={() => editable && setOpen(true)}
          disabled={!editable}
          style={s.cc}
          accessibilityRole="button"
          accessibilityLabel="Select country code">
          <TText variant="bodyMd" style={s.flag as TextStyle}>
            {flagEmoji(iso2)}
          </TText>
          <TText variant="bodyMd" color="textStrong" weight="semibold">
            +{dialCode}
          </TText>
          <Icon name="chevronDown" size={14} color={theme.colors.textMuted} />
        </Pressable>
        <View style={s.divider} />
        <TextInput
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textSubtle}
          keyboardType="phone-pad"
          value={national}
          editable={editable}
          onChangeText={(v) => onChangeNational(v.replace(/[^\d]/g, ''))}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={s.input}
        />
      </View>
      {(error || hint) && (
        <TText variant="bodySm" color={error ? 'error' : 'textMuted'}>
          {error || hint}
        </TText>
      )}

      <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.overlay}>
          <Pressable onPress={() => setOpen(false)} style={s.backdrop} />
          <View style={s.sheet}>
            <View style={s.handle} />
            <TText variant="h4" weight="semibold" style={s.sheetTitle}>
              Select country
            </TText>
            <View style={s.searchWrap}>
              <Icon name="search" size={18} color={theme.colors.textMuted} />
              <TextInput
                placeholder="Search country or code…"
                placeholderTextColor={theme.colors.textSubtle}
                value={query}
                onChangeText={setQuery}
                autoFocus
                autoCapitalize="none"
                style={s.searchInput}
              />
            </View>
            <FlatList
              data={results}
              keyExtractor={(c) => c.iso2}
              keyboardShouldPersistTaps="handled"
              style={s.list}
              renderItem={({ item }) => {
                const sel = item.iso2 === iso2;
                return (
                  <Pressable onPress={() => pick(item)} style={[s.option, sel && s.optionSel]}>
                    <TText variant="bodyMd" style={s.flag as TextStyle}>
                      {flagEmoji(item.iso2)}
                    </TText>
                    <TText variant="bodyMd" color="textStrong" style={s.optionName as TextStyle}>
                      {item.name}
                    </TText>
                    <TText variant="bodyMd" color="textMuted">
                      +{item.dialCode}
                    </TText>
                    {sel && <Icon name="check" size={16} color={theme.colors.primary} />}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <TText variant="bodySm" color="textMuted" style={s.empty}>
                  No matches
                </TText>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createPhoneInputStyles = (
  theme: ThemeStyleProps & {
    controlHeight: typeof import('@/theme/tokens').controlHeight;
    fontFamily: typeof import('@/theme/tokens').fontFamily;
  },
  borderColor: string,
  bottomInset: number,
) =>
  StyleSheet.create({
    root: { ...styles.g1 },
    field: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      paddingHorizontal: moderateScale(12),
      backgroundColor: theme.colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor,
      borderRadius: moderateScale(theme.radius.md),
      height: rSize(theme.controlHeight.md),
    },
    cc: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g1, paddingRight: moderateScale(8) },
    flag: { fontSize: scaleFont(16) },
    divider: {
      width: moderateScale(1),
      alignSelf: 'stretch',
      marginVertical: moderateScale(8),
      backgroundColor: theme.colors.borderSubtle,
    },
    input: {
      ...styles.flex,
      marginLeft: moderateScale(10),
      fontFamily: theme.fontFamily.regular,
      fontSize: scaleFont(15),
      color: theme.colors.textStrong,
      padding: 0,
      includeFontPadding: false,
    } as TextStyle,
    overlay: { ...styles.flex, justifyContent: 'flex-end' },
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: theme.colors.surfaceCard,
      borderTopLeftRadius: moderateScale(theme.radius.xl),
      borderTopRightRadius: moderateScale(theme.radius.xl),
      ...styles.ph5,
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(20) + bottomInset,
      maxHeight: '82%',
    },
    handle: {
      width: moderateScale(40),
      height: moderateScale(4),
      borderRadius: moderateScale(99),
      backgroundColor: theme.colors.borderDefault,
      alignSelf: 'center',
      ...styles.mb4,
    },
    sheetTitle: { ...styles.mb4 },
    searchWrap: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g2,
      paddingHorizontal: moderateScale(12),
      height: rSize(theme.controlHeight.md),
      backgroundColor: theme.colors.surfaceSunken,
      borderRadius: moderateScale(theme.radius.md),
      ...styles.mb3,
    },
    searchInput: {
      ...styles.flex,
      fontFamily: theme.fontFamily.regular,
      fontSize: scaleFont(15),
      color: theme.colors.textStrong,
      padding: 0,
      includeFontPadding: false,
    } as TextStyle,
    list: { flexGrow: 0 },
    option: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g3,
      paddingVertical: moderateScale(12),
      paddingHorizontal: moderateScale(8),
      borderRadius: moderateScale(theme.radius.md),
    },
    optionSel: { backgroundColor: theme.colors.surfaceSunken },
    optionName: { ...styles.flex, ...styles.minWidth0 },
    empty: { ...styles.mt4, textAlign: 'center' },
  });
