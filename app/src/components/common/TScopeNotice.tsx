import React from 'react';
import { StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { useAppState } from '@/state/store';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Tells a staff member what they are actually looking at.
 *
 * Their queue, appointments, calendar and dashboard are all narrowed to their own chair by the
 * backend. Without saying so, an empty screen is ambiguous in the worst way — "the shop is
 * quiet" and "I am not seeing my colleagues' work" look identical, and so does the third case:
 *
 *   A staff login with NO chair linked matches nothing at all, so every one of those screens is
 *   permanently empty. That is the safe way to fail (an unlinked account must not fall back to
 *   seeing everything), but showing an endlessly empty queue is a dead end the person cannot
 *   diagnose or escape on their own.
 *
 * Mirrors owner-web's ScopeNotice. Renders nothing for owners, who are not scoped.
 */
export function TScopeNotice() {
  const { colors } = useTheme();
  const { session } = useAppState();

  if (!session) return null;
  if (session.role !== 'staff' && session.role !== 'manager') return null;

  if (!session.staffId) {
    return (
      <View style={[s.warn, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
        <Icon name="bell" size={16} color={colors.warningSoftFg} />
        <View style={styles.flex}>
          <TText variant="bodySm" weight="semibold" style={{ color: colors.warningSoftFg }}>
            {t.scope.noChairTitle}
          </TText>
          <TText variant="caption" style={[s.warnBody, { color: colors.warningSoftFg }]}>
            {t.scope.noChairBody}
          </TText>
        </View>
      </View>
    );
  }

  return (
    <View style={s.quiet}>
      <Icon name="user" size={14} color={colors.textMuted} />
      <TText variant="caption" color="textMuted">
        {t.scope.ownChairOnly}
      </TText>
    </View>
  );
}

const s = StyleSheet.create({
  warn: {
    ...styles.flexRow,
    gap: moderateScale(10),
    alignItems: 'flex-start',
    padding: moderateScale(12),
    borderWidth: moderateScale(1),
    borderRadius: moderateScale(10),
    marginBottom: moderateScale(12),
  },
  warnBody: {
    marginTop: moderateScale(3),
    lineHeight: moderateScale(17),
  },
  quiet: {
    ...styles.flexRow,
    ...styles.itemsCenter,
    gap: moderateScale(6),
    marginBottom: moderateScale(10),
  },
});
