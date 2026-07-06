import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { TText } from '@/components/common/TText';
import { styles } from '@/styles';
import { moderateScale } from '@/styles/scale';
import type { ThemeStyleProps } from '@/styles/types';
import { palette } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

export function TSwitch({
  checked = false,
  onChange,
  disabled = false,
  label,
}: {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const theme = useTheme();
  const s = useMemo(() => createTSwitchStyles(theme), [theme]);
  const [anim] = useState(() => new Animated.Value(checked ? 1 : 0));

  useEffect(() => {
    Animated.timing(anim, {
      toValue: checked ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [checked, anim]);

  const toggle = (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      disabled={disabled}
      onPress={() => onChange?.(!checked)}
      style={disabled ? s.pressableDisabled : s.pressable}>
      <Animated.View
        style={[
          s.track,
          {
            backgroundColor: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [palette.gray300, theme.colors.primary],
            }),
          },
        ]}>
        <Animated.View
          style={[
            s.knob,
            { left: anim.interpolate({ inputRange: [0, 1], outputRange: [3, SWITCH_WIDTH - SWITCH_KNOB - 3] }) },
          ]}
        />
      </Animated.View>
    </Pressable>
  );

  if (!label) return toggle;

  return (
    <View style={s.row}>
      <TText variant="bodyMd" color="textStrong" weight="medium">
        {label}
      </TText>
      {toggle}
    </View>
  );
}

const SWITCH_WIDTH = moderateScale(42);
const SWITCH_HEIGHT = moderateScale(24);
const SWITCH_KNOB = moderateScale(18);

const createTSwitchStyles = ({ radius, shadow }: ThemeStyleProps) =>
  StyleSheet.create({
    row: { ...styles.flexRow, ...styles.itemsCenter, ...styles.justifyBetween },
    pressable: { opacity: 1 },
    pressableDisabled: { opacity: 0.5 },
    track: {
      width: SWITCH_WIDTH,
      height: SWITCH_HEIGHT,
      borderRadius: moderateScale(radius.pill),
      justifyContent: 'center',
    },
    knob: {
      position: 'absolute',
      top: (SWITCH_HEIGHT - SWITCH_KNOB) / 2,
      width: SWITCH_KNOB,
      height: SWITCH_KNOB,
      borderRadius: SWITCH_KNOB / 2,
      backgroundColor: '#fff',
      ...shadow.sm,
    },
  });
