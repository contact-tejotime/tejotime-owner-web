import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TButton, TText } from '@/components/common';
import { ServiceEditSheet, SettingsPageShell } from '@/components/settings';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { ServiceVM } from '@/data/sample';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

export default function ServicesPricing() {
  const theme = useTheme();
  const store = useAppState();
  const serviceColor = useServiceColor();
  const s = useMemo(() => createServicesStyles(theme), [theme]);
  const [editing, setEditing] = useState<ServiceVM | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openEdit = (sv: ServiceVM | null) => {
    setEditing(sv);
    setSheetOpen(true);
  };

  const onSave = async (f: { name: string; durationMinutes: number; priceRupees: number }) => {
    setSaving(true);
    const ok = editing ? await store.updateService(editing.id, f) : await store.createService(f);
    setSaving(false);
    if (ok) setSheetOpen(false);
  };

  const onRemove = async () => {
    if (!editing) return;
    setSaving(true);
    const ok = await store.removeService(editing.id);
    setSaving(false);
    if (ok) setSheetOpen(false);
  };

  return (
    <SettingsPageShell title={t.services.title}>
      {store.services.length === 0 && (
        <TText variant="bodySm" color="textMuted" style={styles.pt2}>
          {t.services.empty}
        </TText>
      )}
      <View style={s.card}>
        {store.services.map((sv, i) => (
          <Pressable key={sv.id} onPress={() => openEdit(sv)} style={[s.row, i < store.services.length - 1 && s.rowBorder]}>
            <View style={[s.accent, { backgroundColor: serviceColor(sv.colorToken) }]} />
            <View style={s.body}>
              <TText variant="bodyMd" color="textStrong" weight="semibold">
                {sv.name}
              </TText>
              <TText variant="caption" color="textMuted" style={s.sub}>
                {sv.duration}
              </TText>
            </View>
            <TText variant="bodyMd" color="textStrong" weight="bold">
              {sv.price}
            </TText>
            <Icon name="edit" size={16} color={theme.colors.textSubtle} />
          </Pressable>
        ))}
      </View>
      <TButton
        variant="outline"
        fullWidth
        leadingIcon={<Icon name="plus" size={18} color={theme.colors.textStrong} />}
        onPress={() => openEdit(null)}
        style={s.addButton}>
        {t.services.add}
      </TButton>
      <ServiceEditSheet
        open={sheetOpen}
        service={editing}
        saving={saving}
        onClose={() => setSheetOpen(false)}
        onSave={onSave}
        onRemove={onRemove}
      />
    </SettingsPageShell>
  );
}

const createServicesStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
      ...styles.mt1,
    },
    row: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g3,
      ...styles.ph4,
      paddingVertical: moderateScale(13),
    },
    rowBorder: {
      borderBottomWidth: moderateScale(1),
      borderBottomColor: colors.borderSubtle,
    },
    accent: {
      width: moderateScale(4),
      alignSelf: 'stretch',
      borderRadius: moderateScale(radius.pill),
    },
    body: { ...styles.flex, ...styles.minWidth0 },
    sub: { marginTop: moderateScale(3) },
    addButton: { ...styles.mt4 },
  });
