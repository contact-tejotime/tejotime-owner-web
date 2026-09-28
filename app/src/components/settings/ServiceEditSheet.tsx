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
 * Three pricing modes. **Fixed** is one amount. **Range** is a floor and a ceiling: the customer
 * sees the band on the microsite, and whoever checks them out types the real figure, because
 * the shop deliberately said it could not name one in advance. **No price** is the third — price
 * is optional, so the microsite shows none and the amount is typed at checkout, as for a range.
 *
 * A service with no price arrives as `unset` — no price at all, rather than a price of zero. It
 * opens on "No price" with an empty amount box, so switching it to Fixed does not seed a free
 * service by accident.
 */
/** What the sheet hands back. Rupees — the API speaks paise, converted at the call site. */
export interface ServiceFormValues {
  name: string;
  durationMinutes: number;
  priceType: 'fixed' | 'range' | 'unset';
  /** The fixed price, or the range floor. Ignored (0) for 'unset'. */
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
  // An `unset` service opens on "No price" with an empty box: the zero it carries in the database
  // marks "no price", it is not an amount to seed the field with.
  const unpriced = service?.priceType === 'unset';
  const [priceType, setPriceType] = useState<'fixed' | 'range' | 'unset'>(
    service?.priceType === 'range' || service?.priceType === 'unset' ? service.priceType : 'fixed',
  );
  const [price, setPrice] = useState(service && !unpriced ? String(service.priceRupees) : '');
  const [maxPrice, setMaxPrice] = useState(service?.priceMaxRupees != null ? String(service.priceMaxRupees) : '');
  const [error, setError] = useState('');

  const set = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setError('');
  };

  const save = () => {
    const durationMinutes = parseInt(duration, 10);
    // Price is optional, so "No price" needs only a name and a duration.
    if (priceType === 'unset') {
      if (!name.trim() || !durationMinutes || durationMinutes < 1) {
        setError(t.serviceSheet.errorNoPrice);
        return;
      }
      onSave({ name: name.trim(), durationMinutes, priceType, priceRupees: 0, priceMaxRupees: null });
      return;
    }
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

      {/* Segmented, not a picker: there are exactly three modes and the choice changes which
          fields are below it, so it has to be visible rather than one tap away. */}
      <View style={styles.g2}>
        <TText variant="caption" color="textMuted">
          {t.serviceSheet.modeLabel}
        </TText>
        <View style={sheetStyles.row}>
          {(['fixed', 'range', 'unset'] as const).map((mode) => (
            <View key={mode} style={styles.flex}>
              <TButton
                variant={priceType === mode ? 'primary' : 'outline'}
                fullWidth
                onPress={() => {
                  setPriceType(mode);
                  setError('');
                }}>
                {mode === 'fixed'
                  ? t.serviceSheet.modeFixed
                  : mode === 'range'
                    ? t.serviceSheet.modeRange
                    : t.serviceSheet.modeNone}
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
        {priceType !== 'unset' && (
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
        )}
      </View>
      {priceType === 'unset' && (
        <TText variant="bodySm" color="textMuted">
          {t.serviceSheet.priceUnsetHint}
        </TText>
      )}
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
