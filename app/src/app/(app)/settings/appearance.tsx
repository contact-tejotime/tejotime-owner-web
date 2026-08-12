import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { TButton, TInput, TText } from '@/components/common';
import { MicrositePreview } from '@/components/settings/MicrositePreview';
import { SettingsPageShell } from '@/components/settings';
import { WEB_BASE_URL } from '@/lib/config';
import { isOwnerRole } from '@/lib/permissions';
import { showToast } from '@/lib/toast';
import { t, format } from '@/i18n';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';
import {
  ANIMATION_IDS,
  BRAND_INK_IDS,
  DENSITY_IDS,
  getPreset,
  LEGACY_THEME_CONFIG,
  MODE_IDS,
  normalizeThemeConfig,
  PRESET_LIST,
  presetForCategory,
  RADIUS_IDS,
  resolveTheme,
  SHADOW_IDS,
  type AnimationId,
  type BrandInkId,
  type DensityId,
  type PresetId,
  type RadiusId,
  type ShadowId,
  type ThemeConfig,
} from '@/theme/engine';

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const SWATCHES = [
  '#2563EB',
  '#14B8A6',
  '#10B981',
  '#C9A227',
  '#E07A3F',
  '#0EA5E9',
  '#6366F1',
  '#7C3AED',
  '#DB2777',
  '#DC2626',
  '#EA580C',
  '#0F766E',
] as const;

const INHERIT = '__preset__';
type WithInherit<T extends string> = T | typeof INHERIT;

function themeKey(c: ThemeConfig): string {
  return [
    c.preset,
    c.mode,
    c.brand.toUpperCase(),
    c.radius ?? '',
    c.shadow ?? '',
    c.density ?? '',
    c.animation ?? '',
    c.heroVariant ?? '',
    c.accent ?? '',
    c.brandInk ?? '',
  ].join('|');
}

function seedTheme(config: ThemeConfig | null): ThemeConfig {
  return normalizeThemeConfig(config, { ...LEGACY_THEME_CONFIG });
}

/**
 * Owner/co-owner Appearance editor — mirrors owner-web controls, with a WebView live preview
 * of the real customer microsite (`?preview=1` + theme bridge).
 */
export default function AppearanceSettings() {
  const store = useAppState();
  const { themeConfig } = useTheme();
  const role = store.session?.role ?? null;

  useEffect(() => {
    if (!isOwnerRole(role)) router.replace('/(app)/(tabs)/settings');
  }, [role]);

  if (!isOwnerRole(role)) return null;

  return (
    <SettingsPageShell title={t.appearance.title}>
      {/* Remount when business/theme arrives so the form is not stuck on the legacy default. */}
      <AppearanceForm key={store.business?.id ?? (themeConfig ? themeKey(themeConfig) : 'pending')} />
    </SettingsPageShell>
  );
}

function AppearanceForm() {
  const themeCtx = useTheme();
  const store = useAppState();
  const s = useMemo(() => createStyles(themeCtx), [themeCtx]);

  const initial = useMemo(() => seedTheme(themeCtx.themeConfig), [themeCtx.themeConfig]);
  const [theme, setTheme] = useState<ThemeConfig>(initial);
  const [saved, setSaved] = useState<ThemeConfig>(initial);
  const [busy, setBusy] = useState(false);

  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  const preset = getPreset(resolved.config.preset);
  const recommended: PresetId | null = store.business?.category?.trim()
    ? presetForCategory(store.business.category)
    : null;
  const dirty = themeKey(theme) !== themeKey(saved);
  const brandValid = HEX_RE.test(theme.brand.trim());

  const face = resolved.config.mode === 'dark' ? 'dark' : 'light';
  const tokens = face === 'dark' ? resolved.dark : resolved.light;
  const onBrandCheck = resolved.contrast[face].find((c) => c.id === `${face}/on-brand-on-brand`);
  const usesWhiteInk = (tokens['--on-brand'] ?? '#ffffff').toLowerCase() === '#ffffff';
  const ratio = onBrandCheck ? onBrandCheck.ratio.toFixed(2) : '—';
  const brandInk: BrandInkId = theme.brandInk ?? 'auto';
  const manualFailsAa = brandInk !== 'auto' && onBrandCheck != null && !onBrandCheck.pass;
  const gatedFailures = resolved.contrast.failures.filter((c) => c.tier !== 'decorative');

  function setAxis<K extends 'radius' | 'shadow' | 'density' | 'animation'>(
    axis: K,
    value: WithInherit<NonNullable<ThemeConfig[K]>>,
  ) {
    setTheme((prev) => {
      const next: ThemeConfig = { ...prev };
      if (value === INHERIT) delete next[axis];
      else next[axis] = value as ThemeConfig[K];
      return next;
    });
  }

  function setPreset(next: PresetId) {
    setTheme((prev) => {
      const outgoing = getPreset(resolved.config.preset).defaults;
      const cfg: ThemeConfig = { ...prev, preset: next };
      if (cfg.radius === outgoing.radius) delete cfg.radius;
      if (cfg.shadow === outgoing.shadow) delete cfg.shadow;
      if (cfg.density === outgoing.density) delete cfg.density;
      if (cfg.animation === outgoing.animation) delete cfg.animation;
      return cfg;
    });
  }

  function resetToRecommended() {
    setTheme({
      preset: recommended ?? 'minimal',
      mode: theme.mode,
      brand: theme.brand,
    });
  }

  async function save() {
    if (!brandValid) {
      showToast(t.appearance.invalidHex, 'error');
      return;
    }
    setBusy(true);
    const ok = await store.saveAppearance(theme);
    setBusy(false);
    if (ok) setSaved(structuredClone(theme));
  }

  function openSite() {
    const phoneFull = `${store.business?.countryCode ?? ''}${store.business?.phoneNumber ?? ''}`.replace(
      /\D/g,
      '',
    );
    if (!/^\d{7,15}$/.test(phoneFull)) {
      showToast(t.appearance.openSiteMissing, 'error');
      return;
    }
    void Linking.openURL(`${WEB_BASE_URL.replace(/\/+$/, '')}/${phoneFull}`);
  }

  return (
    <View style={s.root}>
      <TText variant="bodySm" color="textMuted" style={s.intro}>
        {t.appearance.subtitle}
      </TText>

      {dirty ? (
        <TText variant="caption" weight="semibold" style={s.unsaved}>
          {t.appearance.unsaved}
        </TText>
      ) : null}

      <Section title={t.appearance.brandTitle} hint={t.appearance.brandHint}>
        <View style={s.swatchRow}>
          {SWATCHES.map((hex) => {
            const selected = brandValid && theme.brand.trim().toUpperCase() === hex;
            return (
              <Pressable
                key={hex}
                onPress={() => setTheme((p) => ({ ...p, brand: hex }))}
                style={[s.swatch, { backgroundColor: hex }, selected && s.swatchSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              />
            );
          })}
        </View>
        <TInput
          label={t.appearance.brandCustom}
          value={theme.brand}
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={(v) => {
            const raw = v.trim();
            const next = raw.startsWith('#') ? raw.toUpperCase() : `#${raw}`.toUpperCase();
            setTheme((p) => ({ ...p, brand: next.slice(0, 7) }));
          }}
          error={!brandValid ? t.appearance.invalidHex : undefined}
        />
        <View style={s.ramp}>
          {([50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const).map((stop) => (
            <View key={stop} style={[s.rampStep, { backgroundColor: resolved.brandRamp[stop] }]} />
          ))}
        </View>
      </Section>

      <Section title={t.appearance.brandInkTitle}>
        <ChipRow
          options={BRAND_INK_IDS.map((id) => ({
            value: id,
            label: t.appearance.brandInks[id].label,
          }))}
          value={brandInk}
          onChange={(ink) => {
            setTheme((prev) => {
              const next: ThemeConfig = { ...prev };
              if (ink === 'auto') delete next.brandInk;
              else next.brandInk = ink;
              return next;
            });
          }}
        />
        <TText variant="caption" color="textMuted" style={s.badge}>
          {format(usesWhiteInk ? t.appearance.aaWhite : t.appearance.aaDark, { ratio })}
        </TText>
        {manualFailsAa ? (
          <TText variant="caption" style={s.warn}>
            {format(t.appearance.aaManualFail, { ratio })}
          </TText>
        ) : null}
        <TText variant="caption" color="textMuted">
          {gatedFailures.length === 0
            ? t.appearance.aaPass
            : format(
                gatedFailures.length === 1 ? t.appearance.aaFail : t.appearance.aaFailPlural,
                { count: gatedFailures.length },
              )}
        </TText>
      </Section>

      <Section title={t.appearance.presetTitle}>
        <View style={s.presetGrid}>
          {PRESET_LIST.map((p) => {
            const selected = resolved.config.preset === p.id;
            const copy = t.appearance.presets[p.id];
            return (
              <Pressable
                key={p.id}
                onPress={() => setPreset(p.id)}
                style={[s.presetCard, selected && s.presetCardSelected]}
              >
                {p.id === recommended ? (
                  <TText variant="caption" weight="bold" style={s.recBadge}>
                    {t.appearance.recommended}
                  </TText>
                ) : null}
                <TText variant="bodySm" weight="semibold" color="textStrong">
                  {copy.label}
                </TText>
                <TText variant="caption" color="textMuted">
                  {copy.desc}
                </TText>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title={t.appearance.modeTitle}>
        <ChipRow
          options={MODE_IDS.map((id) => ({ value: id, label: t.appearance.modes[id].label }))}
          value={resolved.config.mode}
          onChange={(m) => setTheme((p) => ({ ...p, mode: m }))}
        />
      </Section>

      <AxisSection
        title={t.appearance.densityTitle}
        inheritLabel={t.appearance.densities[preset.defaults.density].label}
        value={(theme.density ?? INHERIT) as WithInherit<DensityId>}
        options={DENSITY_IDS.map((id) => ({ value: id, label: t.appearance.densities[id].label }))}
        onChange={(v) => setAxis('density', v)}
      />
      <AxisSection
        title={t.appearance.radiusTitle}
        inheritLabel={t.appearance.radii[preset.defaults.radius].label}
        value={(theme.radius ?? INHERIT) as WithInherit<RadiusId>}
        options={RADIUS_IDS.map((id) => ({ value: id, label: t.appearance.radii[id].label }))}
        onChange={(v) => setAxis('radius', v)}
      />
      <AxisSection
        title={t.appearance.shadowTitle}
        inheritLabel={t.appearance.shadows[preset.defaults.shadow].label}
        value={(theme.shadow ?? INHERIT) as WithInherit<ShadowId>}
        options={SHADOW_IDS.map((id) => ({ value: id, label: t.appearance.shadows[id].label }))}
        onChange={(v) => setAxis('shadow', v)}
      />
      <AxisSection
        title={t.appearance.animationTitle}
        inheritLabel={t.appearance.animations[preset.defaults.animation].label}
        value={(theme.animation ?? INHERIT) as WithInherit<AnimationId>}
        options={ANIMATION_IDS.map((id) => ({
          value: id,
          label: t.appearance.animations[id].label,
        }))}
        onChange={(v) => setAxis('animation', v)}
      />

      <TText variant="caption" color="textMuted" style={s.effective}>
        {format(t.appearance.effective, {
          preset: t.appearance.presets[resolved.config.preset].label,
          mode: t.appearance.modes[resolved.config.mode].label,
          density: t.appearance.densities[resolved.config.density].label,
          radius: t.appearance.radii[resolved.config.radius].label,
          shadow: t.appearance.shadows[resolved.config.shadow].label,
          animation: t.appearance.animations[resolved.config.animation].label,
        })}
      </TText>

      <MicrositePreview
        config={theme}
        phoneFull={`${store.business?.countryCode ?? ''}${store.business?.phoneNumber ?? ''}`.replace(
          /\D/g,
          '',
        )}
      />

      <View style={s.actions}>
        <TButton variant="secondary" size="md" fullWidth onPress={resetToRecommended}>
          {t.appearance.reset}
        </TButton>
        <TButton variant="secondary" size="md" fullWidth onPress={openSite}>
          {t.appearance.openSite}
        </TButton>
        <TButton
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          disabled={!dirty || !brandValid}
          onPress={save}
        >
          {t.appearance.save}
        </TButton>
      </View>
    </View>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={s.section}>
      <TText variant="bodySm" weight="bold" color="textStrong" style={s.sectionTitle}>
        {title}
      </TText>
      {hint ? (
        <TText variant="caption" color="textMuted" style={s.sectionHint}>
          {hint}
        </TText>
      ) : null}
      <View style={s.card}>
        <View style={s.cardBody}>{children}</View>
      </View>
    </View>
  );
}

function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={s.chipRow}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[s.chip, selected && s.chipSelected]}
          >
            <TText
              variant="caption"
              weight="semibold"
              color={selected ? 'primary' : 'textBody'}
            >
              {o.label}
            </TText>
          </Pressable>
        );
      })}
    </View>
  );
}

function AxisSection<T extends string>({
  title,
  inheritLabel,
  value,
  options,
  onChange,
}: {
  title: string;
  inheritLabel: string;
  value: WithInherit<T>;
  options: { value: T; label: string }[];
  onChange: (v: WithInherit<T>) => void;
}) {
  return (
    <Section title={title}>
      <ChipRow
        options={[
          { value: INHERIT as WithInherit<T>, label: `${t.appearance.presetDefault} (${inheritLabel})` },
          ...options,
        ]}
        value={value}
        onChange={onChange}
      />
    </Section>
  );
}

const createStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    root: { paddingTop: moderateScale(4), paddingBottom: moderateScale(28) },
    intro: { marginBottom: moderateScale(16), marginLeft: moderateScale(2) },
    unsaved: { color: colors.warning, marginBottom: moderateScale(12), marginLeft: moderateScale(2) },
    section: { marginBottom: moderateScale(22) },
    sectionTitle: { marginBottom: moderateScale(6), marginLeft: moderateScale(2) },
    sectionHint: { marginBottom: moderateScale(8), marginLeft: moderateScale(2) },
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      overflow: 'hidden',
    },
    cardBody: {
      padding: moderateScale(14),
      gap: moderateScale(14),
    },
    swatchRow: { ...styles.flexRow, flexWrap: 'wrap', gap: moderateScale(8) },
    swatch: {
      width: moderateScale(36),
      height: moderateScale(36),
      borderRadius: moderateScale(radius.sm),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(15,23,42,0.14)',
    },
    swatchSelected: {
      borderWidth: moderateScale(2),
      borderColor: colors.textStrong,
    },
    ramp: {
      ...styles.flexRow,
      height: moderateScale(22),
      borderRadius: moderateScale(radius.sm),
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
    },
    rampStep: { flex: 1 },
    badge: { marginTop: moderateScale(4) },
    warn: { color: colors.warning, marginTop: moderateScale(2) },
    presetGrid: { ...styles.flexRow, flexWrap: 'wrap', gap: moderateScale(10) },
    presetCard: {
      width: '47%',
      flexGrow: 1,
      padding: moderateScale(12),
      borderRadius: moderateScale(radius.md),
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surfaceSunken,
      gap: moderateScale(4),
    },
    presetCardSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    recBadge: { color: colors.success, textTransform: 'uppercase', letterSpacing: 0.4 },
    chipRow: { ...styles.flexRow, flexWrap: 'wrap', gap: moderateScale(8) },
    chip: {
      paddingVertical: moderateScale(8),
      paddingHorizontal: moderateScale(12),
      borderRadius: moderateScale(radius.md),
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      backgroundColor: colors.surfaceSunken,
    },
    chipSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    effective: {
      padding: moderateScale(12),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.surfaceSunken,
      marginBottom: moderateScale(16),
    },
    actions: { gap: moderateScale(10), marginTop: moderateScale(8) },
  });
