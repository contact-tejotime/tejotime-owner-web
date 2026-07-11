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
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** When false, render a plain KeyboardAvoidingView for screens that manage their own scrolling. */
  isScrollView?: boolean;
}) {
  const behavior = Platform.OS === 'ios' ? 'padding' : undefined;

  if (!isScrollView) {
    return (
      <KeyboardAvoidingView style={[styles.flex, style]} behavior={behavior}>
        {children}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.flex, style]} behavior={behavior}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
