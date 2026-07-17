import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { TButton, TText } from '@/components/common';
import { SettingsPageShell } from '@/components/settings';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { subscription } from '@/data/settings';
import { showToast } from '@/lib/toast';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { useTheme } from '@/theme/ThemeProvider';

export default function Subscription() {
  const theme = useTheme();
  const s = useMemo(() => createSubscriptionStyles(theme), [theme]);

  return (
    <SettingsPageShell title={t.subscription.title}>
      <View style={s.card}>
        <View style={s.planRow}>
          <TText variant="h4" color="textStrong" weight="extrabold" style={s.planName}>
            {subscription.plan}
          </TText>
          <Badge tone="primary" size="sm">
            {subscription.badge}
          </Badge>
        </View>
        <TText variant="bodySm" color="textMuted" style={s.planSub}>
          {subscription.sub}
        </TText>
        <View style={s.features}>
          {subscription.features.map((f) => (
            <View key={f} style={s.featureRow}>
              <Icon name="checkCircle" size={18} color={theme.colors.success} />
              <TText variant="bodySm" color="textBody" style={styles.flex}>
                {f}
              </TText>
            </View>
          ))}
        </View>
      </View>
      <TButton
        variant="primary"
        size="lg"
        fullWidth
        onPress={() => showToast(t.toast.welcomePremium, 'success')}
        style={s.cta}>
        {subscription.cta}
      </TButton>
      <TText variant="caption" color="textSubtle" align="center" style={s.footnote}>
        {t.subscription.footnote}
      </TText>
    </SettingsPageShell>
  );
}

const createSubscriptionStyles = ({ colors, radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceCard,
      borderWidth: moderateScale(1),
      borderColor: colors.borderSubtle,
      borderRadius: moderateScale(radius.lg),
      padding: moderateScale(18),
      ...shadow.xs,
      ...styles.mt1,
    },
    planRow: { ...styles.flexRow, ...styles.itemsCenter, ...styles.justifyBetween, ...styles.g2 },
    planName: { letterSpacing: moderateScale(-0.4) },
    planSub: { marginTop: moderateScale(5) },
    features: {
      ...styles.g3,
      marginTop: moderateScale(16),
      paddingTop: moderateScale(15),
      borderTopWidth: moderateScale(1),
      borderTopColor: colors.borderSubtle,
    },
    featureRow: { ...styles.flexRow, ...styles.itemsCenter, ...styles.g2 },
    cta: { ...styles.mt4 },
    footnote: { ...styles.mt3 },
  });
