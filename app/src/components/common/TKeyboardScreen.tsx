import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleProp,
  ViewStyle,
} from 'react-native';

import { styles } from '@/styles';

export function TKeyboardScreen({
  children,
  style,
  contentContainerStyle,
  isScrollView = true,
  keyboardVerticalOffset = 0,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** When false, render a plain KeyboardAvoidingView for screens that manage their own scrolling. */
  isScrollView?: boolean;
  keyboardVerticalOffset?: number;
}) {
  const behavior = Platform.OS === 'ios' ? 'padding' : 'padding';

  if (!isScrollView) {
    return (
      <KeyboardAvoidingView
        style={[styles.flex, style]}
        behavior={behavior}
        keyboardVerticalOffset={keyboardVerticalOffset}>
        {children}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, style]}
      behavior={behavior}
      keyboardVerticalOffset={keyboardVerticalOffset}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        bounces={false}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
