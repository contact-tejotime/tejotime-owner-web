import Toast from 'react-native-toast-message';

export type ToastType = 'success' | 'error' | 'info';

/** One button on the toast — "Undo" after hiding a customer from the call list. */
export interface ToastAction {
  label: string;
  onPress: () => void;
}

/**
 * A toast with an action stays long enough to reach it (owner-web's toast does the same), and the
 * whole toast is the button: TToast draws the label at its trailing edge.
 */
export function showToast(text1: string, type: ToastType = 'info', text2?: string, opts: { action?: ToastAction } = {}) {
  const action = opts.action;
  Toast.show({
    type,
    text1,
    text2,
    visibilityTime: action ? 6000 : 2200,
    props: action ? { actionLabel: action.label } : undefined,
    onPress: action
      ? () => {
          Toast.hide();
          action.onPress();
        }
      : undefined,
  });
}
