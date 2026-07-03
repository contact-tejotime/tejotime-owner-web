import React, { useEffect, useState } from 'react';
import { Animated, Pressable } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';

const W = 42;
const H = 24;
const KNOB = 18;

export function Switch({
  checked = false,
  onChange,
  disabled = false,
}: {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { colors, radius, shadow } = useTheme();
  const [anim] = useState(() => new Animated.Value(checked ? 1 : 0));

  useEffect(() => {
    Animated.timing(anim, {
      toValue: checked ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [checked, anim]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      disabled={disabled}
      onPress={() => onChange?.(!checked)}
      style={{ opacity: disabled ? 0.5 : 1 }}>
      <Animated.View
        style={{
          width: W,
          height: H,
          borderRadius: radius.pill,
          backgroundColor: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [palette.gray300, colors.primary],
          }),
          justifyContent: 'center',
        }}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: (H - KNOB) / 2,
              width: KNOB,
              height: KNOB,
              borderRadius: KNOB / 2,
              backgroundColor: '#fff',
              left: anim.interpolate({ inputRange: [0, 1], outputRange: [3, W - KNOB - 3] }),
            },
            shadow.sm,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
