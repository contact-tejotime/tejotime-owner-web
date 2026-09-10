import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TButton, TInput, TText } from '@/components/common';
import { EditSheet } from '@/components/settings/EditSheet';
import { t } from '@/i18n';
import { ServiceVM } from '@/data/sample';
import { styles } from '@/styles';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Add/edit bottom sheet for a service (name, duration, pricing).
 *
 * Two pricing modes. **Fixed** is one amount. **Range** is a floor and a ceiling: the customer
 * sees the band on the microsite, and whoever checks them out types the real figure, because
 * the shop deliberately said it could not name one in advance.
 *
 * A service saved before pricing modes existed arrives as `unset` — no price at all, rather
 * than a price of zero. The form opens it on Fixed with an empty box and says so, because the
 * API will not accept it back until a real mode and amount are chosen.
 */
/** What the sheet hands back. Rupees — the API speaks paise, converted at the call site. */
export interface ServiceFormValues {
  name: string;
  durationMinutes: number;
  priceType: 'fixed' | 'range';
  /** The fixed price, or the range floor. */
  priceRupees: number;
  /** The range ceiling. Null for a fixed price — and written as null, so a service switched
   *  back from range does not keep a ceiling the API would reject. */
  priceMaxRupees: number | null;
}

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
  onSave: (f: ServiceFormValues) => void;
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
  onSave: (f: ServiceFormValues) => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState(service?.name ?? '');
  const [duration, setDuration] = useState(service ? String(service.durationMinutes) : '');
  // An `unset` service opens on Fixed with an empty box: it has no price to show, and the zero
  // it carries in the database is a legacy marker, not an amount to seed the field with.
  const legacyUnpriced = service?.priceType === 'unset';
  const [priceType, setPriceType] = useState<'fixed' | 'range'>(service?.priceType === 'range' ? 'range' : 'fixed');
  const [price, setPrice] = useState(service && !legacyUnpriced ? String(service.priceRupees) : '');
  const [maxPrice, setMaxPrice] = useState(service?.priceMaxRupees != null ? String(service.priceMaxRupees) : '');
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
    if (priceType === 'range') {
      const priceMaxRupees = parseFloat(maxPrice);
      if (!priceMaxRupees || priceMaxRupees <= 0) {
        setError(t.serviceSheet.error);
        return;
      }
      if (priceMaxRupees < priceRupees) {
        setError(t.serviceSheet.errorRange);
        return;
      }
      onSave({ name: name.trim(), durationMinutes, priceType, priceRupees, priceMaxRupees });
      return;
    }
    onSave({ name: name.trim(), durationMinutes, priceType, priceRupees, priceMaxRupees: null });
  };

  return (
    <View style={styles.g4}>
      <TInput label={t.serviceSheet.nameLabel} placeholder={t.serviceSheet.namePlaceholder} value={name} onChangeText={set(setName)} />
      {legacyUnpriced && (
        <TText variant="bodySm" color="textMuted">
          {t.serviceSheet.unpricedHint}
        </TText>
      )}

      {/* Segmented, not a picker: there are exactly two modes and the choice changes which
          fields are below it, so it has to be visible rather than one tap away. */}
      <View style={styles.g2}>
        <TText variant="caption" color="textMuted">
          {t.serviceSheet.modeLabel}
        </TText>
        <View style={sheetStyles.row}>
          {(['fixed', 'range'] as const).map((mode) => (
            <View key={mode} style={styles.flex}>
              <TButton
                variant={priceType === mode ? 'primary' : 'outline'}
                fullWidth
                onPress={() => {
                  setPriceType(mode);
                  setError('');
                }}>
                {mode === 'fixed' ? t.serviceSheet.modeFixed : t.serviceSheet.modeRange}
              </TButton>
            </View>
          ))}
        </View>
      </View>

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
            label={priceType === 'range' ? t.serviceSheet.priceMinLabel : t.serviceSheet.priceLabel}
            prefix={t.serviceSheet.pricePrefix}
            placeholder={t.serviceSheet.pricePlaceholder}
            keyboardType="number-pad"
            value={price}
            onChangeText={set(setPrice)}
          />
        </View>
      </View>
      {priceType === 'range' && (
        <>
          <TInput
            label={t.serviceSheet.priceMaxLabel}
            prefix={t.serviceSheet.pricePrefix}
            placeholder={t.serviceSheet.priceMaxPlaceholder}
            keyboardType="number-pad"
            value={maxPrice}
            onChangeText={set(setMaxPrice)}
          />
          <TText variant="bodySm" color="textMuted">
            {t.serviceSheet.rangeHint}
          </TText>
        </>
      )}
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
