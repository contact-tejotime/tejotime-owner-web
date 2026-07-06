import Toast from 'react-native-toast-message';

export type ToastType = 'success' | 'error' | 'info';

export function showToast(text1: string, type: ToastType = 'info', text2?: string) {
  Toast.show({
    type,
    text1,
    text2,
    visibilityTime: 2200,
  });
}
