import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TButton, TText } from '@/components/common';
import { SettingsPageShell, StaffEditSheet } from '@/components/settings';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { Staff } from '@/data/sample';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useServiceColor } from '@/theme/serviceColor';
import { useTheme } from '@/theme/ThemeProvider';

export default function StaffSeats() {
  const theme = useTheme();
  const store = useAppState();
  const staffColor = useServiceColor();
  const s = useMemo(() => createStaffStyles(theme), [theme]);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openEdit = (st: Staff | null) => {
    setEditing(st);
    setSheetOpen(true);
  };

  const onSave = async (f: { name: string; roleLabel: string }) => {
    setSaving(true);
    const ok = editing ? await store.updateStaffMember(editing.id, f) : await store.createStaffMember(f);
    setSaving(false);
    if (ok) setSheetOpen(false);
  };

  return (
    <SettingsPageShell title={t.staff.title}>
      {store.staff.length === 0 && (
        <TText variant="bodySm" color="textMuted" style={styles.pt2}>
          {t.staff.empty}
        </TText>
      )}
      <View style={s.card}>
        {store.staff.map((st, i) => (
          <Pressable key={st.id} onPress={() => openEdit(st)} style={[s.row, i < store.staff.length - 1 && s.rowBorder]}>
            <View style={[s.avatar, { backgroundColor: staffColor(st.color) }]}>
              <TText variant="bodyMd" weight="bold" style={s.avatarText}>
                {st.name[0]}
              </TText>
            </View>
            <View style={s.body}>
              <TText variant="bodyMd" color="textStrong" weight="semibold">
                {st.name}
              </TText>
              <TText variant="caption" color="textMuted" style={s.sub}>
                {st.roleLabel ?? t.staff.roleFallback}
              </TText>
            </View>
            <Icon name="chevronRight" size={18} color={theme.colors.textSubtle} />
          </Pressable>
        ))}
      </View>
      <TText variant="caption" color="textSubtle" style={s.footnote}>
        {t.staff.note}
      </TText>
      <TButton
        variant="outline"
        fullWidth
        leadingIcon={<Icon name="plus" size={18} color={theme.colors.textStrong} />}
        onPress={() => openEdit(null)}
        style={s.addButton}>
        {t.staff.add}
      </TButton>
      <StaffEditSheet
        open={sheetOpen}
        member={editing}
        saving={saving}
        onClose={() => setSheetOpen(false)}
        onSave={onSave}
      />
    </SettingsPageShell>
  );
}

const createStaffStyles = ({ colors, radius }: ThemeStyleProps) =>
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
    avatar: {
      ...styles.nonFlexCenter,
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(18),
    },
    avatarText: { color: '#fff' },
    body: { ...styles.flex, ...styles.minWidth0 },
    sub: { marginTop: moderateScale(3) },
    footnote: { ...styles.mt3, ...styles.mh1 },
    addButton: { ...styles.mt4 },
  });
