import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TButton, TInput, TText } from '@/components/common';
import { EditSheet } from '@/components/settings/EditSheet';
import { t } from '@/i18n';
import { ServiceVM } from '@/data/sample';
import { styles } from '@/styles';
import { useTheme } from '@/theme/ThemeProvider';

/** Add/edit bottom sheet for a service (name, duration, price). */
export function ServiceEditSheet({
  open,
  service,
  saving,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  service: ServiceVM | null;
  saving: boolean;
  onClose: () => void;
  onSave: (f: { name: string; durationMinutes: number; priceRupees: number }) => void;
  onRemove: () => void;
}) {
  return (
    <EditSheet visible={open} title={service ? t.serviceSheet.editTitle : t.serviceSheet.addTitle} onClose={onClose}>
      {open && (
        <ServiceForm key={service?.id ?? 'new'} service={service} saving={saving} onSave={onSave} onRemove={onRemove} />
      )}
    </EditSheet>
  );
}

/** Remounted per open/service (via key) so field state seeds from props without effects. */
function ServiceForm({
  service,
  saving,
  onSave,
  onRemove,
}: {
  service: ServiceVM | null;
  saving: boolean;
  onSave: (f: { name: string; durationMinutes: number; priceRupees: number }) => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState(service?.name ?? '');
  const [duration, setDuration] = useState(service ? String(service.durationMinutes) : '');
  const [price, setPrice] = useState(service ? String(service.priceRupees) : '');
  const [error, setError] = useState('');

  const set = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setError('');
  };

  const save = () => {
    const durationMinutes = parseInt(duration, 10);
    const priceRupees = parseFloat(price);
    if (!name.trim() || !durationMinutes || durationMinutes < 1 || !priceRupees || priceRupees <= 0) {
      setError(t.serviceSheet.error);
      return;
    }
    onSave({ name: name.trim(), durationMinutes, priceRupees });
  };

  return (
    <View style={styles.g4}>
      <TInput label={t.serviceSheet.nameLabel} placeholder={t.serviceSheet.namePlaceholder} value={name} onChangeText={set(setName)} />
      <View style={sheetStyles.row}>
        <View style={styles.flex}>
          <TInput
            label={t.serviceSheet.durationLabel}
            placeholder={t.serviceSheet.durationPlaceholder}
            keyboardType="number-pad"
            value={duration}
            onChangeText={set(setDuration)}
          />
        </View>
        <View style={styles.flex}>
          <TInput
            label={t.serviceSheet.priceLabel}
            prefix={t.serviceSheet.pricePrefix}
            placeholder={t.serviceSheet.pricePlaceholder}
            keyboardType="number-pad"
            value={price}
            onChangeText={set(setPrice)}
          />
        </View>
      </View>
      {!!error && (
        <TText variant="bodySm" color="error">
          {error}
        </TText>
      )}
      <TButton variant="primary" size="lg" fullWidth loading={saving} onPress={save}>
        {t.serviceSheet.save}
      </TButton>
      {service && (
        <TButton variant="ghost" fullWidth textColor={colors.error} disabled={saving} onPress={onRemove}>
          {t.serviceSheet.remove}
        </TButton>
      )}
    </View>
  );
}

const sheetStyles = StyleSheet.create({
  row: { ...styles.flexRow, ...styles.g3 },
});
