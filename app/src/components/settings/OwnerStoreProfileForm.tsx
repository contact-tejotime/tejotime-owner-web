import { Image } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { TButton, TEmptyState, TInput, TText } from '@/components/common';
import { Icon } from '@/components/ui/Icon';
import { format, t } from '@/i18n';
import { DEFAULT_DIAL_CODE } from '@/lib/phone';
import { familyFor } from '@/lib/store-family';
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

/** The gallery heading's longest value — the API's limit (`galleryHeading` max 40). */
const GALLERY_HEADING_MAX = 40;

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
  const [taglineError, setTaglineError] = useState<string | undefined>(undefined);
  const [heroSubtitle, setHeroSubtitle] = useState(biz?.heroSubtitle ?? '');
  const [address, setAddress] = useState(biz?.address ?? '');
  const [area, setArea] = useState(biz?.area ?? '');
  const [city, setCity] = useState(biz?.city ?? '');
  const [aboutHeading, setAboutHeading] = useState(biz?.aboutHeading ?? '');
  const [description, setDescription] = useState(biz?.description ?? '');
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
  const [yelpUrl, setYelpUrl] = useState(biz?.yelpUrl ?? '');
  const [googleReviewUrl, setGoogleReviewUrl] = useState(biz?.googleReviewUrl ?? '');
  const [payments, setPayments] = useState((biz?.payments ?? []).join(', '));
  const [amenities, setAmenities] = useState<string[]>(biz?.amenities ?? []);
  const [gallery, setGallery] = useState<GalleryItem[]>(
    (biz?.gallery ?? []).map((g) => ({ url: g.url, alt: g.alt ?? null })),
  );
  const [faqs, setFaqs] = useState<Faq[]>(biz?.faqs?.length ? biz.faqs : []);
  const [reviews, setReviews] = useState<Review[]>(biz?.reviews?.length ? biz.reviews : []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  // Gallery heading: '' = Default (the page follows the store type's default, even if it changes).
  const [galleryHeading, setGalleryHeading] = useState(biz?.galleryHeading ?? '');
  // Sticky "Custom…" choice. Without it, typing a custom heading that happens to spell a ready-made
  // one ("Our Work") would flip the selection to that chip and hide the input mid-word. Seeded from
  // the saved value: anything that is not one of this store type's ready-made headings is Custom.
  const [headingCustom, setHeadingCustom] = useState(() => {
    const saved = biz?.galleryHeading ?? '';
    return saved !== '' && !t.galleryHeadings[familyFor(biz?.category)].includes(saved);
  });

  // Recomputed from the CURRENT category field, so the lists follow an edit before it is saved.
  const family = familyFor(category);
  const readyHeadings = t.galleryHeadings[family];
  const typeDefaultHeading = readyHeadings[0];
  const headlineIdeas = t.headlineSuggestions[family];
  // A ready-made heading from another store type (the category was just edited) shows as Custom,
  // text intact, rather than being silently dropped.
  const headingIsCustom =
    headingCustom || (galleryHeading !== '' && !readyHeadings.includes(galleryHeading));
  const shownHeading = galleryHeading.trim() || typeDefaultHeading;

  /** One option of the gallery-heading choice (a radio chip, same look as Appearance's chips). */
  const headingChoice = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={[s.chip, selected && s.chipSelected]}
    >
      <TText variant="caption" weight="semibold" color={selected ? 'primary' : 'textBody'}>
        {label}
      </TText>
    </Pressable>
  );

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
    // The headline is required: a blank one left the page with an empty top heading. The API
    // ignores a blank tagline rather than refusing it (older builds send whatever the field holds),
    // so without this check the owner would see "Saved" with the old headline still live. The field
    // sits at the top of a long form, out of view of this button, so the toast says it too.
    if (!tagline.trim()) {
      setTaglineError(t.profile.taglineRequired);
      showToast(t.profile.taglineRequired, 'error');
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
    // Same rule as the API and owner-web: the link is texted to customers; carriers filter http.
    const reviewLink = googleReviewUrl.trim();
    if (reviewLink && !/^https:\/\/\S+\.\S+/i.test(reviewLink)) {
      showToast(t.profile.reviewLinkInvalid, 'error');
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
        // Always sent: this form is only rendered for owner roles (settings/profile.tsx), and the
        // API refuses this field from a staff login. A blank custom heading saves as Default ('').
        galleryHeading: galleryHeading.trim(),
        establishedYear: year,
        logoUrl: logoUrl.trim(),
        heroImageUrl: heroImageUrl.trim(),
        aboutImageUrl: aboutImageUrl.trim(),
        instagramUrl: instagramUrl.trim(),
        facebookUrl: facebookUrl.trim(),
        twitterUrl: twitterUrl.trim(),
        linkedinUrl: linkedinUrl.trim(),
        yelpUrl: yelpUrl.trim(),
        googleReviewUrl: reviewLink,
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
        <View style={s.fieldWithChips}>
          <TInput
            label={t.profile.taglineLabel}
            value={tagline}
            onChangeText={(v) => {
              setTagline(v);
              if (taglineError && v.trim()) setTaglineError(undefined);
            }}
            hint={t.profile.taglineHint}
            error={taglineError}
          />
          {/* Tap-to-use ideas for this kind of store; a tap REPLACES the headline. */}
          <View style={s.chipRow}>
            <TText variant="caption" color="textMuted" weight="semibold" style={s.chipLead}>
              {t.profile.taglineIdeas}
            </TText>
            {headlineIdeas.map((idea) => {
              const selected = tagline === idea;
              return (
                <Pressable
                  key={idea}
                  onPress={() => {
                    setTagline(idea);
                    setTaglineError(undefined);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[s.chip, selected && s.chipSelected]}
                >
                  <TText variant="caption" weight="semibold" color={selected ? 'primary' : 'textBody'}>
                    {idea}
                  </TText>
                </Pressable>
              );
            })}
          </View>
        </View>
        <TInput
          label={t.profile.heroSubtitleLabel}
          value={heroSubtitle}
          onChangeText={setHeroSubtitle}
          hint={t.profile.heroSubtitleHint}
        />
      </Section>

      <Section title={t.profile.sectionWhere}>
        <TInput label={t.profile.addressLabel} value={address} onChangeText={setAddress} />
        <TInput
          label={t.profile.areaLabel}
          value={area}
          onChangeText={setArea}
          placeholder={t.profile.areaPlaceholder}
          hint={t.profile.areaHint}
        />
        <TInput label={t.profile.cityLabel} value={city} onChangeText={setCity} />
        <TInput
          label={t.profile.phoneLabel}
          prefix={`+${biz?.countryCode ?? DEFAULT_DIAL_CODE}`}
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
          hint={t.profile.aboutImageHint}
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
        <TInput
          label={t.profile.yelpLabel}
          value={yelpUrl}
          onChangeText={setYelpUrl}
          autoCapitalize="none"
          keyboardType="url"
        />
        {/* Not shown on the microsite — where the post-visit review text points (empty = none sent). */}
        <TInput
          label={t.profile.reviewLinkLabel}
          value={googleReviewUrl}
          onChangeText={setGoogleReviewUrl}
          placeholder="https://g.page/r/your-place-id/review"
          hint={t.profile.reviewLinkHint}
          autoCapitalize="none"
          keyboardType="url"
        />
      </Section>

      <Section title={t.profile.sectionGallery}>
        <View style={[s.blockGap, s.imageDivider]}>
          <View style={s.labelBlock}>
            <TText variant="bodySm" color="textStrong" weight="semibold">
              {t.profile.galleryHeadingLabel}
            </TText>
            <TText variant="caption" color="textMuted">
              {t.profile.galleryHeadingHint}
            </TText>
          </View>
          <View style={s.chipRow} accessibilityRole="radiogroup">
            {headingChoice(
              'default',
              format(t.profile.galleryHeadingDefault, { heading: typeDefaultHeading }),
              !headingIsCustom && galleryHeading === '',
              () => {
                setHeadingCustom(false);
                setGalleryHeading('');
              },
            )}
            {readyHeadings.map((h) =>
              headingChoice(`ready:${h}`, h, !headingIsCustom && galleryHeading === h, () => {
                setHeadingCustom(false);
                setGalleryHeading(h);
              }),
            )}
            {headingChoice('custom', t.profile.galleryHeadingCustom, headingIsCustom, () => {
              if (headingIsCustom) return;
              // Starts empty so the placeholder invites their own words; left blank, it saves as Default.
              setHeadingCustom(true);
              setGalleryHeading('');
            })}
          </View>
          {headingIsCustom ? (
            <TInput
              value={galleryHeading}
              onChangeText={(v) => {
                setHeadingCustom(true);
                setGalleryHeading(v);
              }}
              placeholder={t.profile.galleryHeadingPlaceholder}
              maxLength={GALLERY_HEADING_MAX}
              accessibilityLabel={t.profile.galleryHeadingLabel}
            />
          ) : null}
        </View>

        <View style={s.blockGap}>
          <View style={s.labelBlock}>
            <TText variant="bodySm" color="textStrong" weight="semibold">
              {format(t.profile.galleryPhotosFor, { heading: shownHeading })}
            </TText>
            <TText variant="caption" color="textMuted">
              {t.profile.galleryHint}
            </TText>
          </View>
          {gallery.length === 0 ? <TEmptyState compact icon="grid" title={t.profile.galleryEmpty} /> : null}
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
        </View>
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
    blockGap: { gap: moderateScale(10) },
    labelBlock: { gap: moderateScale(2) },
    fieldWithChips: { gap: moderateScale(10) },
    chipRow: { ...styles.flexRow, ...styles.itemsCenter, flexWrap: 'wrap', gap: moderateScale(8) },
    chipLead: { marginRight: moderateScale(2) },
    chip: {
      // A long option ("Default for your store type — …") wraps inside its chip instead of
      // running off the card on a narrow phone or at a large system text size.
      maxWidth: '100%',
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
