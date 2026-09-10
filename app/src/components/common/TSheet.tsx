import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { t } from '@/i18n';

/**
 * Bottom sheet chrome: the dimmed backdrop and the slide-up panel.
 *
 * WHY THIS EXISTS. Every sheet used to be `<Modal animationType="slide">` with the backdrop
 * rendered *inside* the modal. RN's `slide` translates the whole modal, backdrop included, so the
 * dark scrim slid up from the bottom edge as a moving rectangle instead of the screen dimming in
 * place — the giveaway that a sheet is hand-rolled rather than native. The two layers have to
 * animate differently: the backdrop **fades**, the panel **slides**.
 *
 * So the Modal itself is `animationType="none"` and both layers are driven here.
 *
 * The component stays mounted through the closing animation — `visible` going false starts the
 * exit and unmounts only once it lands, otherwise the sheet would vanish instantly on close and
 * undo half the point.
 */

const IN_MS = 260;
const OUT_MS = 190;
/** Used until `onLayout` reports the real height — only has to be taller than any sheet. */
const FALLBACK_H = 900;

export function TSheet({
  visible,
  onClose,
  children,
  contentStyle,
  /** Set false for a sheet that must not be dismissed by tapping the scrim. */
  dismissOnBackdropPress = true,
  /** Lift the panel clear of the keyboard — for sheets that contain text inputs. */
  keyboardAvoiding = false,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  dismissOnBackdropPress?: boolean;
  keyboardAvoiding?: boolean;
}) {
  const progress = useSharedValue(0);
  const height = useSharedValue(0);

  // `exiting` keeps the sheet mounted while it animates out. Tracked with the render-phase
  // previous-value pattern rather than an effect, because setState inside an effect body
  // cascades renders (and the React Compiler lint rejects it).
  const [exiting, setExiting] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (!visible) setExiting(true);
  }

  useEffect(() => {
    if (visible) {
      progress.value = withTiming(1, { duration: IN_MS, easing: Easing.out(Easing.cubic) });
      return;
    }
    progress.value = withTiming(
      0,
      { duration: OUT_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setExiting)(false);
      },
    );
  }, [visible, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * (height.value || FALLBACK_H) }],
  }));

  if (!visible && !exiting) return null;

  // Plain function, not useCallback: a shared value must not be listed as a hook dependency and
  // then written to (react-hooks/immutability), and reanimated's identity is already stable.
  const onSheetLayout = (e: LayoutChangeEvent) => {
    height.value = e.nativeEvent.layout.height;
  };

  const Root = keyboardAvoiding ? KeyboardAvoidingView : Animated.View;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[sheetStyles.backdrop, backdropStyle]}>
        <Pressable
          style={sheetStyles.fill}
          onPress={dismissOnBackdropPress ? onClose : undefined}
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
        />
      </Animated.View>
      <Root style={sheetStyles.root} pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}>
        {/* `layout` keeps a sheet whose content grows (the walk-in service checklist) from
            snapping to its new height — see the note in AddWalkInSheet. */}
        <Animated.View
          layout={LinearTransition}
          style={[contentStyle, sheetStyle]}
          onLayout={onSheetLayout}>
          {children}
        </Animated.View>
      </Root>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  root: { flex: 1, justifyContent: 'flex-end' },
});
