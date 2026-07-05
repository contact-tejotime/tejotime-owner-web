import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import ToastLib, { BaseToast, type BaseToastProps } from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { moderateScale } from '@/styles/scale';
import { fontFamily, fontSize } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

type ToastVariant = 'success' | 'error' | 'info';

function ThemedToast({ variant, ...props }: BaseToastProps & { variant: ToastVariant }) {
  const { colors, shadow } = useTheme();
  const tone = useMemo(() => {
    switch (variant) {
      case 'success':
        return {
          border: colors.success,
          background: colors.successSoft,
          text: colors.successSoftFg,
        };
      case 'error':
        return {
          border: colors.error,
          background: colors.errorSoft,
          text: colors.errorSoftFg,
        };
      case 'info':
      default:
        return {
          border: colors.info,
          background: colors.infoSoft,
          text: colors.infoSoftFg,
        };
    }
  }, [colors, variant]);

  return (
    <BaseToast
      {...props}
      style={[
        tToastStyles.toast,
        shadow.md,
        { borderLeftColor: tone.border, backgroundColor: tone.background },
      ]}
      contentContainerStyle={tToastStyles.content}
      text1Style={[tToastStyles.text1, { color: tone.text }]}
      text2Style={[tToastStyles.text2, { color: colors.textBody }]}
      text1NumberOfLines={2}
      text2NumberOfLines={2}
    />
  );
}

export function TToast() {
  const insets = useSafeAreaInsets();

  return (
    <View style={tToastStyles.host} pointerEvents="box-none">
      <ToastLib
        swipeable={false}
        position="top"
        visibilityTime={2200}
        topOffset={insets.top + moderateScale(12)}
        config={{
          success: (props) => <ThemedToast {...props} variant="success" />,
          error: (props) => <ThemedToast {...props} variant="error" />,
          info: (props) => <ThemedToast {...props} variant="info" />,
        }}
      />
    </View>
  );
}

const tToastStyles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999999,
    elevation: 999999,
    backgroundColor: 'red',
  },
  toast: {
    borderLeftWidth: moderateScale(4),
    borderRadius: moderateScale(10),
    minHeight: moderateScale(56),
    zIndex: 999999,
    elevation: 999999,
    backgroundColor: 'blue',

  },
  content: {
    paddingHorizontal: moderateScale(15),
  },
  text1: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.bodySm,
  },
  text2: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.caption,
  },
});
