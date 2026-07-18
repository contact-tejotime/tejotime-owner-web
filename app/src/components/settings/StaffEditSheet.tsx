import { Image } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { TButton, TInput, TText } from '@/components/common';
import { EditSheet } from '@/components/settings/EditSheet';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { Staff } from '@/data/sample';
import { pickAndUploadAvatar } from '@/lib/upload';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

type StaffFormValues = { name: string; roleLabel: string; photoUrl: string | null };

/** Add/edit bottom sheet for a staff member (photo, name, role). */
export function StaffEditSheet({
  open,
  member,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  member: Staff | null;
  saving: boolean;
  onClose: () => void;
  onSave: (f: StaffFormValues) => void;
}) {
  return (
    <EditSheet visible={open} title={member ? t.staffSheet.editTitle : t.staffSheet.addTitle} onClose={onClose}>
      {open && <StaffForm key={member?.id ?? 'new'} member={member} saving={saving} onSave={onSave} />}
    </EditSheet>
  );
}

/** Remounted per open/member (via key) so field state seeds from props without effects. */
function StaffForm({
  member,
  saving,
  onSave,
}: {
  member: Staff | null;
  saving: boolean;
  onSave: (f: StaffFormValues) => void;
}) {
  const theme = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState(member?.roleLabel ?? t.staffSheet.roleFallback);
  const [photoUrl, setPhotoUrl] = useState<string | null>(member?.photoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const pickPhoto = async () => {
    setUploading(true);
    setError('');
    try {
      const url = await pickAndUploadAvatar();
      if (url) setPhotoUrl(url);
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not upload photo.');
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    if (!name.trim()) {
      setError(t.staffSheet.error);
      return;
    }
    onSave({ name: name.trim(), roleLabel: role.trim(), photoUrl });
  };

  return (
    <View style={styles.g4}>
      <View style={s.photoRow}>
        <Pressable onPress={pickPhoto} disabled={uploading || saving} style={s.avatar}>
          {uploading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : photoUrl ? (
            <Image source={{ uri: photoUrl }} style={s.avatarImg} contentFit="cover" />
          ) : (
            <Icon name="user" size={26} color={theme.colors.textSubtle} />
          )}
        </Pressable>
        <View style={styles.g2}>
          <TButton variant="outline" size="sm" onPress={pickPhoto} loading={uploading} disabled={saving}>
            {photoUrl ? 'Change photo' : 'Add photo'}
          </TButton>
          {photoUrl && !uploading && (
            <Pressable onPress={() => setPhotoUrl(null)} disabled={saving}>
              <TText variant="bodySm" color="error">
                Remove photo
              </TText>
            </Pressable>
          )}
        </View>
      </View>

      <TInput
        label={t.staffSheet.nameLabel}
        placeholder={t.staffSheet.namePlaceholder}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError('');
        }}
      />
      <TInput label={t.staffSheet.roleLabel} placeholder={t.staffSheet.rolePlaceholder} value={role} onChangeText={setRole} />
      {!!error && (
        <TText variant="bodySm" color="error">
          {error}
        </TText>
      )}
      <TButton variant="primary" size="lg" fullWidth loading={saving} disabled={uploading} onPress={save}>
        {t.staffSheet.save}
      </TButton>
    </View>
  );
}

const createStyles = ({ colors }: ThemeStyleProps) =>
  StyleSheet.create({
    photoRow: {
      ...styles.flexRow,
      ...styles.itemsCenter,
      ...styles.g4,
    },
    avatar: {
      ...styles.nonFlexCenter,
      width: moderateScale(64),
      height: moderateScale(64),
      borderRadius: moderateScale(32),
      backgroundColor: colors.surfaceSunken,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      overflow: 'hidden',
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
  });
