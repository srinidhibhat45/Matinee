import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { SearchField } from './m3';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onClear?: () => void;
  autoFocus?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Thin wrapper over the M3 search bar, kept so existing screens can keep
 * importing `SearchBar` while the styling lives in one place.
 */
export default function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search movies & shows',
  onFocus,
  onClear,
  autoFocus = false,
  leading,
  trailing,
  style,
}: SearchBarProps) {
  return (
    <SearchField
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      onFocus={onFocus}
      onClear={onClear}
      autoFocus={autoFocus}
      leading={leading}
      trailing={trailing}
      style={style}
    />
  );
}
