import { Image } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { TButton, TInput, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { showToast } from '@/lib/toast';
import { pickAndUploadImage, type UploadAssetType } from '@/lib/upload';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

type Faq = { q: string; a: string };
type Review = { stars: number; text: string; authorName: string };
type GalleryItem = { url: string; alt?: string | null };

function splitPayments(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Full store profile editor — mirrors owner-web StoreProfileEditor (without Appearance). */
export function OwnerStoreProfileForm() {
  const theme = useTheme();
  const store = useAppState();
  const biz = store.business;
  const s = useMemo(() => createStyles(theme), [theme]);

  const [name, setName] = useState(biz?.name ?? '');
  const [category, setCategory] = useState(biz?.category ?? '');
  const [tagline, setTagline] = useState(biz?.tagline ?? '');
  const [heroSubtitle, setHeroSubtitle] = useState(biz?.heroSubtitle ?? '');
  const [address, setAddress] = useState(biz?.address ?? '');
  const [area, setArea] = useState(biz?.area ?? '');
  const [city, setCity] = useState(biz?.city ?? '');
  const [aboutHeading, setAboutHeading] = useState(biz?.aboutHeading ?? '');
  const [description, setDescription] = useState(biz?.description ?? '');
  const [statValue, setStatValue] = useState(biz?.statValue ?? '');
  const [statLabel, setStatLabel] = useState(biz?.statLabel ?? '');
  const [establishedYear, setEstablishedYear] = useState(
    biz?.establishedYear != null ? String(biz.establishedYear) : '',
  );
  const [logoUrl, setLogoUrl] = useState(biz?.logoUrl ?? '');
  const [heroImageUrl, setHeroImageUrl] = useState(biz?.heroImageUrl ?? '');
  const [aboutImageUrl, setAboutImageUrl] = useState(biz?.aboutImageUrl ?? '');
  const [instagramUrl, setInstagramUrl] = useState(biz?.instagramUrl ?? '');
  const [facebookUrl, setFacebookUrl] = useState(biz?.facebookUrl ?? '');
  const [twitterUrl, setTwitterUrl] = useState(biz?.twitterUrl ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(biz?.linkedinUrl ?? '');
  const [payments, setPayments] = useState((biz?.payments ?? []).join(', '));
  const [amenities, setAmenities] = useState<string[]>(biz?.amenities ?? []);
  const [gallery, setGallery] = useState<GalleryItem[]>(
    (biz?.gallery ?? []).map((g) => ({ url: g.url, alt: g.alt ?? null })),
  );
  const [faqs, setFaqs] = useState<Faq[]>(biz?.faqs?.length ? biz.faqs : []);
  const [reviews, setReviews] = useState<Review[]>(biz?.reviews?.length ? biz.reviews : []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const upload = async (assetType: UploadAssetType, onUrl: (url: string) => void) => {
    setUploading(assetType);
    try {
      const url = await pickAndUploadImage(assetType, {
        allowsEditing: assetType === 'logo',
        aspect: assetType === 'logo' ? [1, 1] : undefined,
      });
      if (url) onUrl(url);
    } catch (e) {
      showToast((e as Error)?.message ?? t.toast.couldNotSaveProfile, 'error');
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      showToast(t.profile.nameRequired, 'error');
      return;
    }
    const yearRaw = establishedYear.trim();
    const year = yearRaw ? Number(yearRaw) : null;
    if (yearRaw && (!Number.isFinite(year) || year! < 1800 || year! > 2100)) {
      showToast(t.profile.yearInvalid, 'error');
      return;
    }
    if (gallery.filter((g) => g.url.trim()).length > 7) {
      showToast(t.profile.galleryFull, 'error');
      return;
    }

    setSaving(true);
    const ok = await store.saveProfile(
      {
        name: name.trim(),
        category: category.trim(),
        tagline: tagline.trim(),
        heroSubtitle: heroSubtitle.trim(),
        address: address.trim(),
        area: area.trim(),
        city: city.trim(),
        aboutHeading: aboutHeading.trim(),
        description: description.trim(),
        statValue: statValue.trim(),
        statLabel: statLabel.trim(),
        establishedYear: year,
        logoUrl: logoUrl.trim(),
        heroImageUrl: heroImageUrl.trim(),
        aboutImageUrl: aboutImageUrl.trim(),
        instagramUrl: instagramUrl.trim(),
        facebookUrl: facebookUrl.trim(),
        twitterUrl: twitterUrl.trim(),
        linkedinUrl: linkedinUrl.trim(),
        payments: splitPayments(payments),
        faqs: faqs.filter((f) => f.q.trim() && f.a.trim()),
        reviews: reviews.filter((r) => r.text.trim() && r.authorName.trim()),
      },
      {
        amenities: amenities.map((a) => a.trim()).filter(Boolean),
        gallery: gallery.filter((g) => g.url.trim()),
      },
    );
    setSaving(false);
    if (ok) router.back();
  };

  return (
    <View style={s.form}>
      <Section title={t.profile.sectionBasics}>
        <TInput label={t.profile.nameLabel} value={name} onChangeText={setName} />
        <TInput
          label={t.profile.categoryLabel}
          value={category}
          onChangeText={setCategory}
          placeholder={t.profile.categoryPlaceholder}
          hint={t.profile.categoryHint}
        />
        <TInput
          label={t.profile.taglineLabel}
          value={tagline}
          onChangeText={setTagline}
          placeholder={t.profile.taglinePlaceholder}
        />
        <TInput
          label={t.profile.heroSubtitleLabel}
          value={heroSubtitle}
          onChangeText={setHeroSubtitle}
          hint={t.profile.heroSubtitleHint}
        />
      </Section>

      <Section title={t.profile.sectionWhere}>
        <TInput label={t.profile.addressLabel} value={address} onChangeText={setAddress} />
        <TInput label={t.profile.areaLabel} value={area} onChangeText={setArea} />
        <TInput label={t.profile.cityLabel} value={city} onChangeText={setCity} />
        <TInput
          label={t.profile.phoneLabel}
          prefix={`+${biz?.countryCode ?? '91'}`}
          value={biz?.phoneNumber ?? ''}
          disabled
          hint={t.profile.phoneLockedHint}
        />
      </Section>

      <Section title={t.profile.sectionStory}>
        <TInput label={t.profile.aboutHeadingLabel} value={aboutHeading} onChangeText={setAboutHeading} />
        <TInput
          label={t.profile.descriptionLabel}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
        />
        <View style={s.row}>
          <View style={s.half}>
            <TInput
              label={t.profile.statValueLabel}
              value={statValue}
              onChangeText={setStatValue}
              placeholder={t.profile.statValuePlaceholder}
            />
          </View>
          <View style={s.half}>
            <TInput
              label={t.profile.statLabelLabel}
              value={statLabel}
              onChangeText={setStatLabel}
              placeholder={t.profile.statLabelPlaceholder}
            />
          </View>
        </View>
        <TInput
          label={t.profile.yearLabel}
          value={establishedYear}
          onChangeText={setEstablishedYear}
          placeholder={t.profile.yearPlaceholder}
          keyboardType="number-pad"
        />
      </Section>

      <Section title={t.profile.sectionPictures}>
        <ImagePickerRow
          label={t.profile.logoLabel}
          url={logoUrl}
          busy={uploading === 'logo'}
          onPick={() => upload('logo', setLogoUrl)}
          onClear={() => setLogoUrl('')}
          showDivider
        />
        <ImagePickerRow
          label={t.profile.heroImageLabel}
          hint={t.profile.heroImageHint}
          url={heroImageUrl}
          busy={uploading === 'hero'}
          onPick={() => upload('hero', setHeroImageUrl)}
          onClear={() => setHeroImageUrl('')}
          showDivider
        />
        <ImagePickerRow
          label={t.profile.aboutImageLabel}
          url={aboutImageUrl}
          busy={uploading === 'about'}
          onPick={() => upload('about', setAboutImageUrl)}
          onClear={() => setAboutImageUrl('')}
        />
      </Section>

      <Section title={t.profile.sectionSocial} hint={t.profile.socialHint}>
        <TInput
          label={t.profile.instagramLabel}
          value={instagramUrl}
          onChangeText={setInstagramUrl}
          autoCapitalize="none"
          keyboardType="url"
        />
        <TInput
          label={t.profile.facebookLabel}
          value={facebookUrl}
          onChangeText={setFacebookUrl}
          autoCapitalize="none"
          keyboardType="url"
        />
        <TInput
          label={t.profile.twitterLabel}
          value={twitterUrl}
          onChangeText={setTwitterUrl}
          autoCapitalize="none"
          keyboardType="url"
        />
        <TInput
          label={t.profile.linkedinLabel}
          value={linkedinUrl}
          onChangeText={setLinkedinUrl}
          autoCapitalize="none"
          keyboardType="url"
        />
      </Section>

      <Section title={t.profile.sectionGallery} hint={t.profile.galleryHint}>
        {gallery.length === 0 ? (
          <TText variant="bodySm" color="textMuted">
            {t.profile.galleryEmpty}
          </TText>
        ) : null}
        {gallery.map((g, i) => (
          <View key={`${g.url}-${i}`} style={s.galleryRow}>
            <Image source={{ uri: g.url }} style={s.galleryThumb} contentFit="cover" />
            <View style={s.galleryActions}>
              {i > 0 ? (
                <TButton
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    setGallery((xs) => {
                      const next = [...xs];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      return next;
                    })
                  }
                >
                  {t.profile.galleryMoveUp}
                </TButton>
              ) : null}
              <TButton
                variant="secondary"
                size="sm"
                onPress={() => setGallery((xs) => xs.filter((_, idx) => idx !== i))}
              >
                {t.profile.galleryRemove}
              </TButton>
            </View>
          </View>
        ))}
        <TButton
          variant="secondary"
          size="md"
          loading={uploading === 'gallery'}
          disabled={gallery.length >= 7 || uploading === 'gallery'}
          onPress={() => {
            if (gallery.length >= 7) {
              showToast(t.profile.galleryFull, 'error');
              return;
            }
            upload('gallery', (url) =>
              setGallery((xs) => (xs.length >= 7 ? xs : [...xs, { url, alt: null }])),
            );
          }}
        >
          {t.profile.galleryAdd}
        </TButton>
      </Section>

      <Section title={t.profile.sectionOffer}>
        <TInput
          label={t.profile.paymentsLabel}
          value={payments}
          onChangeText={setPayments}
          placeholder={t.profile.paymentsPlaceholder}
          hint={t.profile.paymentsHint}
        />
        <View style={s.blockGap}>
          <TText variant="bodySm" color="textStrong" weight="semibold">
            {t.profile.amenitiesLabel}
          </TText>
          {amenities.length === 0 ? (
            <TText variant="caption" color="textMuted">
              {t.profile.amenitiesEmpty}
            </TText>
          ) : null}
          {amenities.map((a, i) => (
            <View key={i} style={s.listRow}>
              <View style={styles.flex}>
                <TInput
                  value={a}
                  onChangeText={(v) => setAmenities((xs) => xs.map((x, idx) => (idx === i ? v : x)))}
                  placeholder={t.profile.amenityPlaceholder}
                />
              </View>
              <Pressable
                onPress={() => setAmenities((xs) => xs.filter((_, idx) => idx !== i))}
                accessibilityLabel={t.profile.removeAmenity}
                style={s.iconBtn}
              >
                <Icon name="x" size={18} color={theme.colors.textMuted} />
              </Pressable>
            </View>
          ))}
          <TButton variant="secondary" size="md" onPress={() => setAmenities((xs) => [...xs, ''])}>
            {t.profile.addAmenity}
          </TButton>
        </View>
      </Section>

      <Section title={t.profile.sectionFaqs} hint={t.profile.faqsHint}>
        {faqs.map((f, i) => (
          <View key={i} style={s.nestedCard}>
            <TInput
              label={t.profile.faqQuestion}
              value={f.q}
              onChangeText={(v) => setFaqs((xs) => xs.map((x, idx) => (idx === i ? { ...x, q: v } : x)))}
            />
            <TInput
              label={t.profile.faqAnswer}
              value={f.a}
              onChangeText={(v) => setFaqs((xs) => xs.map((x, idx) => (idx === i ? { ...x, a: v } : x)))}
              multiline
              numberOfLines={3}
            />
            <TButton variant="secondary" size="sm" onPress={() => setFaqs((xs) => xs.filter((_, idx) => idx !== i))}>
              {t.profile.removeFaq}
            </TButton>
          </View>
        ))}
        <TButton variant="secondary" size="md" onPress={() => setFaqs((xs) => [...xs, { q: '', a: '' }])}>
          {t.profile.addFaq}
        </TButton>
      </Section>

      <Section title={t.profile.sectionReviews} hint={t.profile.reviewsHint}>
        {reviews.map((r, i) => (
          <View key={i} style={s.nestedCard}>
            <TInput
              label={t.profile.reviewAuthor}
              value={r.authorName}
              onChangeText={(v) =>
                setReviews((xs) => xs.map((x, idx) => (idx === i ? { ...x, authorName: v } : x)))
              }
            />
            <TInput
              label={t.profile.reviewStars}
              value={String(r.stars)}
              onChangeText={(v) => {
                const n = Math.min(5, Math.max(1, Number(v.replace(/[^0-9]/g, '')) || 5));
                setReviews((xs) => xs.map((x, idx) => (idx === i ? { ...x, stars: n } : x)));
              }}
              keyboardType="number-pad"
            />
            <TInput
              label={t.profile.reviewText}
              value={r.text}
              onChangeText={(v) => setReviews((xs) => xs.map((x, idx) => (idx === i ? { ...x, text: v } : x)))}
              multiline
              numberOfLines={3}
            />
            <TButton
              variant="secondary"
              size="sm"
              onPress={() => setReviews((xs) => xs.filter((_, idx) => idx !== i))}
            >
              {t.profile.removeReview}
            </TButton>
          </View>
        ))}
        <TButton
          variant="secondary"
          size="md"
          onPress={() => setReviews((xs) => [...xs, { stars: 5, text: '', authorName: '' }])}
        >
          {t.profile.addReview}
        </TButton>
      </Section>

      <View style={s.saveWrap}>
        <TButton variant="primary" size="lg" fullWidth loading={saving} onPress={save}>
          {t.profile.save}
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
      <TText variant="bodySm" color="textStrong" weight="bold" style={s.sectionTitle}>
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

function ImagePickerRow({
  label,
  hint,
  url,
  busy,
  onPick,
  onClear,
  showDivider = false,
}: {
  label: string;
  hint?: string;
  url: string;
  busy: boolean;
  onPick: () => void;
  onClear: () => void;
  showDivider?: boolean;
}) {
  const theme = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[s.imageBlock, showDivider && s.imageDivider]}>
      <TText variant="bodySm" color="textStrong" weight="semibold">
        {label}
      </TText>
      {hint ? (
        <TText variant="caption" color="textMuted">
          {hint}
        </TText>
      ) : null}
      {url ? <Image source={{ uri: url }} style={s.preview} contentFit="cover" /> : null}
      <View style={s.row}>
        <TButton variant="secondary" size="md" onPress={onPick} loading={busy}>
          {url ? t.profile.changeImage : t.profile.addImage}
        </TButton>
        {url ? (
          <TButton variant="secondary" size="md" onPress={onClear} disabled={busy}>
            {t.profile.removeImage}
          </TButton>
        ) : null}
      </View>
    </View>
  );
}

const createStyles = ({ colors, radius }: ThemeStyleProps) =>
  StyleSheet.create({
    form: { paddingTop: moderateScale(4), paddingBottom: moderateScale(28) },
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
      padding: moderateScale(16),
      gap: moderateScale(16),
    },
    row: { ...styles.flexRow, ...styles.g2, ...styles.itemsStart },
    half: { ...styles.flex },
    blockGap: { gap: moderateScale(10) },
    nestedCard: {
      gap: moderateScale(12),
      padding: moderateScale(12),
      backgroundColor: colors.surfaceSunken,
      borderRadius: moderateScale(radius.md),
    },
    listRow: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g2 },
    iconBtn: {
      ...styles.nonFlexCenter,
      width: moderateScale(40),
      height: moderateScale(40),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.surfaceSunken,
      marginTop: moderateScale(2),
    },
    imageBlock: { gap: moderateScale(8) },
    imageDivider: {
      paddingBottom: moderateScale(14),
      marginBottom: moderateScale(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    preview: {
      width: '100%',
      height: moderateScale(148),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.surfaceSunken,
    },
    galleryRow: {
      ...styles.flexRow,
      ...styles.g3,
      ...styles.itemsCenter,
      paddingVertical: moderateScale(4),
    },
    galleryThumb: {
      width: moderateScale(72),
      height: moderateScale(72),
      borderRadius: moderateScale(radius.md),
      backgroundColor: colors.surfaceSunken,
    },
    galleryActions: { ...styles.flex, ...styles.g2 },
    saveWrap: { marginTop: moderateScale(4), marginBottom: moderateScale(8) },
  });
