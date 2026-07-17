import { Image } from 'expo-image';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { moderateScale } from '@/styles/scale';

const logo = require('@/assets/images/logo-full.png');

export function TSplashScreen() {
  return (
    <View style={splashStyles.root}>
      <Image source={logo} style={splashStyles.logo} contentFit="contain" accessibilityLabel={t.common.brand} />
      <ActivityIndicator size="small" color="#2563EB" style={splashStyles.loader} />
    </View>
  );
}

const splashStyles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: moderateScale(32),
  },
  logo: {
    width: moderateScale(280),
    height: moderateScale(186),
  },
  loader: {
    position: 'absolute',
    bottom: moderateScale(48),
  },
});
