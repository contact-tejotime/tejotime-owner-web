import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextStyle, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ServiceCard } from '@/components/cards/ServiceCard';
import { PhoneInput, TKeyboardScreen, TText } from '@/components/common';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { useResponsive } from '@/hooks/useResponsive';
import { t, format } from '@/i18n';
import { combineToE164, DEFAULT_DIAL_CODE, DEFAULT_ISO2 } from '@/lib/phone';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useAppState } from '@/state/store';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

import { createSheetOverlayStyles } from './QRSheet';

function SegButton({
  label,
  on,
  onPress,
  s,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  s: ReturnType<typeof createAddWalkInSheetStyles>;
}) {
  return (
    <Pressable onPress={onPress} style={s.segmentBtnStyle(on)}>
      <TText variant="bodySm" weight="semibold" style={s.segmentLabelStyle(on) as TextStyle}>
        {label}
      </TText>
    </Pressable>
  );
}

export function AddWalkInSheet() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const resolveColor = useServiceColor();
  const store = useAppState();
  const open = store.sheet === 'walkin';
  const [name, setName] = useState('');
  const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
  const [iso2, setIso2] = useState(DEFAULT_ISO2);
  const [national, setNational] = useState('');
  const { centerStyle } = useResponsive(560);

  // Reset the typed fields when the sheet opens (render-phase previous-value
  // pattern — mirrors the store's openWalkin reset without a setState-in-effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setDialCode(DEFAULT_DIAL_CODE);
      setIso2(DEFAULT_ISO2);
      setNational('');
    }
  }
  const overlay = useMemo(() => createSheetOverlayStyles(), []);
  const s = useMemo(() => createAddWalkInSheetStyles(theme, insets.bottom), [theme, insets.bottom]);

  // Derived seat options — recomputed only when the seats/staff change.
  const staffOptions = useMemo(() => {
    const seatById = Object.fromEntries(store.seats.map((g) => [g.id, g]));
    let autoSeat = store.staff[0]?.id ?? '';
    let bestLoad = Infinity;
    store.staff.forEach((st) => {
      const load = seatById[st.id]?.clearMinutes ?? 0;
      if (load < bestLoad) {
        bestLoad = load;
        autoSeat = st.id;
      }
    });
    const autoName = store.staff.find((st) => st.id === autoSeat)?.name ?? '';

    return [
      {
        id: 'auto',
        name: t.walkin.anySeat,
        auto: true,
        initial: '',
        sub: format(t.walkin.soonestFree, { name: autoName }),
        color: theme.colors.textSubtle,
      },
      ...store.staff.map((st) => {
        const g = seatById[st.id];
        const w = g?.waitN ?? 0;
        const load = g?.clearMinutes ?? 0;
        return {
          id: st.id,
          name: st.name,
          auto: false,
          initial: st.name[0],
          sub: w === 0 ? t.walkin.freeNow : format(t.walkin.load, { waiting: w, load }),
          color: resolveColor(st.color),
        };
      }),
    ];
    // resolveColor is derived from theme; theme.colors covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.seats, store.staff, theme.colors]);

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={store.closeWalkin}>
      <TKeyboardScreen isScrollView={false} style={overlay.root}>
        <Pressable onPress={store.closeWalkin} style={overlay.backdrop} />
        <View style={[s.sheet, centerStyle]}>
          <View style={s.handle} />
          <TText variant="h4" weight="semibold" style={s.title}>
            {t.walkin.title}
          </TText>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Input
              label={t.walkin.nameLabel}
              placeholder={t.walkin.namePlaceholder}
              value={name}
              onChangeText={setName}
              containerStyle={s.nameInput}
            />
            <PhoneInput
              label={t.walkin.phoneLabel}
              placeholder={t.walkin.phonePlaceholder}
              dialCode={dialCode}
              iso2={iso2}
              national={national}
              onChangeCountry={(c) => {
                setDialCode(c.dialCode);
                setIso2(c.iso2);
              }}
              onChangeNational={setNational}
            />

            <TText variant="bodySm" weight="medium" color="textBody" style={s.sectionLabel}>
              {t.walkin.service}
            </TText>
            <View style={s.list}>
              {store.services.map((sv) => (
                <ServiceCard
                  key={sv.name}
                  name={sv.name}
                  duration={sv.duration}
                  price={sv.price}
                  color={resolveColor(sv.color)}
                  selected={store.walkin.service === sv.name}
                  onPress={() => store.pickService(sv.name)}
                />
              ))}
            </View>
            {!!store.walkin.error && (
              <TText variant="bodySm" color="error" style={s.error}>
                {store.walkin.error}
              </TText>
            )}

            <TText variant="bodySm" weight="medium" color="textBody" style={s.sectionLabel}>
              {t.walkin.assignSeat}
            </TText>
            <View style={s.list}>
              {staffOptions.map((o) => {
                const sel = store.walkin.staffId === o.id;
                return (
                  <Pressable key={o.id} onPress={() => store.setWalkinStaff(o.id)} style={s.seatOptionStyle(sel)}>
                    <View style={s.seatAvatarBg(o.color)}>
                      {o.auto ? (
                        <Icon name="sparkles" size={15} color="#fff" />
                      ) : (
                        <TText weight="bold" style={s.seatAvatarText}>
                          {o.initial}
                        </TText>
                      )}
                    </View>
                    <View style={s.seatBody}>
                      <TText variant="bodyMd" weight="semibold">
                        {o.name}
                      </TText>
                      <TText variant="caption" color="textMuted" style={s.seatSub}>
                        {o.sub}
                      </TText>
                    </View>
                    {sel && <Icon name="check" size={18} color={theme.colors.primary} />}
                  </Pressable>
                );
              })}
            </View>

            <TText variant="bodySm" weight="medium" color="textBody" style={s.sectionLabel}>
              {t.walkin.addAs}
            </TText>
            <View style={s.segmentWrap}>
              <SegButton label={t.walkin.endOfQueue} on={store.walkin.position === 'end'} onPress={() => store.setWalkinPosition('end')} s={s} />
              <SegButton label={t.walkin.nextUp} on={store.walkin.position === 'next'} onPress={() => store.setWalkinPosition('next')} s={s} />
            </View>
            <TText variant="caption" color="textSubtle" style={s.hint}>
              {t.walkin.nextUpNote}
            </TText>
          </ScrollView>

          <View style={s.footer}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={store.walkinLoading}
              onPress={() => store.addWalkin({ name, phone: combineToE164(dialCode, national) })}>
              {t.walkin.add}
            </Button>
          </View>
        </View>
      </TKeyboardScreen>
    </Modal>
  );
}

const createAddWalkInSheetStyles = ({ colors, radius, shadow }: ThemeStyleProps, bottomInset: number) => {
  const base = StyleSheet.create({
    sheet: {
      backgroundColor: colors.surfaceCard,
      borderTopLeftRadius: moderateScale(radius.xl),
      borderTopRightRadius: moderateScale(radius.xl),
      ...styles.ph5,
      paddingTop: moderateScale(18),
      paddingBottom: moderateScale(26) + bottomInset,
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
    title: { ...styles.mb4 },
    nameInput: { ...styles.mb4 },
    sectionLabel: { marginTop: moderateScale(18), marginBottom: moderateScale(8) },
    list: { ...styles.g2 },
    error: { ...styles.mt3 },
    seatOption: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      gap: moderateScale(11),
      borderRadius: moderateScale(radius.lg),
      paddingHorizontal: moderateScale(13),
      paddingVertical: moderateScale(11),
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1.5),
      borderColor: colors.borderSubtle,
    },
    seatOptionSelected: { borderColor: colors.primary },
    seatAvatar: {
      ...styles.nonFlexCenter,
      width: moderateScale(30),
      height: moderateScale(30),
      borderRadius: moderateScale(15),
    },
    seatAvatarText: { fontSize: moderateScale(13), color: '#fff' },
    seatBody: { ...styles.flex, ...styles.minWidth0 },
    seatSub: { ...styles.mt1 },
    segmentWrap: {
      ...styles.flexRow,
      gap: moderateScale(4),
      backgroundColor: colors.surfaceSunken,
      borderRadius: moderateScale(radius.lg),
      padding: moderateScale(4),
    },
    segmentBtn: { ...styles.flex, alignItems: 'center', borderRadius: moderateScale(radius.md), paddingVertical: moderateScale(10) },
    segmentBtnOn: { backgroundColor: colors.surfaceCard, ...shadow.xs },
    segmentLabelOn: { color: colors.primary },
    segmentLabelOff: { color: colors.textMuted },
    hint: { ...styles.mt2 },
    footer: { ...styles.mt4 },
  });

  return {
    ...base,
    seatOptionStyle: (selected: boolean) => [base.seatOption, selected ? base.seatOptionSelected : null],
    seatAvatarBg: (color: string) => [base.seatAvatar, { backgroundColor: color }],
    segmentBtnStyle: (on: boolean) => [base.segmentBtn, on ? base.segmentBtnOn : null],
    segmentLabelStyle: (on: boolean) => (on ? base.segmentLabelOn : base.segmentLabelOff) as TextStyle,
  };
};
