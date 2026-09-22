import { Image } from 'expo-image';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { initials } from '@/lib/format';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The store's mark: its uploaded logo when it has one, otherwise its initials on a solid tile of the
 * brand colour. Used wherever the app shows "this store" beside its name: Home's header and the
 * Settings header.
 *
 * It replaced `InitialsAvatar` in both places. That was a pale tint of the brand behind
 * brand-tinted initials, and on a warm page (a red brand on a beige preset, say) the tint all but
 * vanished: owners reported nothing showing in front of the store name. A solid brand tile with the
 * brand's ink reads on any page, light or dark. A logo sits on the card surface with a hairline
 * border, so a white-background logo still has an edge. If the logo fails to load, the tile falls
 * back to initials rather than leaving an empty frame.
 *
 * `InitialsAvatar` is still right for *people* (customer cards), where a quiet tint is the point.
 */
export function StoreMark({ name, logoUrl, size = 46 }: { name: string; logoUrl?: string; size?: number }) {
  const { colors, radius } = useTheme();
  const [failed, setFailed] = useState(false);
  const dim = moderateScale(size);
  const frame = { width: dim, height: dim, borderRadius: moderateScale(radius.md) };

  if (logoUrl && !failed) {
    return (
      <View style={[s.frame, frame, { backgroundColor: colors.surfaceCard, borderColor: colors.borderDefault }]}>
        <Image
          source={{ uri: logoUrl }}
          style={s.fill}
          contentFit="cover"
          transition={150}
          accessibilityLabel={name}
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  return (
    <View style={[s.frame, frame, s.center, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
      <TText
        weight="extrabold"
        maxFontSizeMultiplier={1}
        style={[s.initials, { fontSize: moderateScale(Math.round(size * 0.37)), color: colors.textOnBrand }]}>
        {initials(name)}
      </TText>
    </View>
  );
}

const s = StyleSheet.create({
  frame: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
  center: { ...styles.itemsCenter, ...styles.justifyCenter },
  fill: { width: '100%', height: '100%' },
  initials: { letterSpacing: 0.3 },
});
