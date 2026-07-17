import React from 'react';
import { TextInputProps } from 'react-native';

import { TInput } from '@/components/common/TInput';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';

export function TSearchInput({
  placeholder = t.search.placeholder,
  ...rest
}: Omit<TextInputProps, 'leadingIcon'> & { placeholder?: string }) {
  const { colors } = useTheme();

  return (
    <TInput
      placeholder={placeholder}
      leadingIcon={<Icon name="search" size={18} color={colors.textMuted} />}
      autoCapitalize="none"
      autoCorrect={false}
      {...rest}
    />
  );
}
