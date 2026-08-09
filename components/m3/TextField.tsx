import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { density, shape, spacing, typescale, MIN_TOUCH_TARGET } from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';
import Text from './Text';
import Touchable from './Touchable';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Helper copy below the field. Replaced by `errorText` when invalid. */
  supportingText?: string;
  errorText?: string;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  onTrailingIconPress?: () => void;
  trailingIconLabel?: string;
  variant?: 'outlined' | 'filled';
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Material 3 text field.
 *
 * The label sits above the box rather than floating into the outline: RN has no
 * cheap way to cut a notch in a border, and a persistent label is both simpler
 * and better for screen readers, which get a real `accessibilityLabel` either
 * way.
 */
export default function TextField({
  label,
  supportingText,
  errorText,
  leadingIcon,
  trailingIcon,
  onTrailingIconPress,
  trailingIconLabel,
  variant = 'outlined',
  style,
  containerStyle,
  onFocus,
  onBlur,
  editable = true,
  ...rest
}: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const hasError = !!errorText;

  const borderColor = hasError
    ? colors.error
    : focused
      ? colors.primary
      : colors.outline;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text
          variant="labelMedium"
          color={hasError ? colors.error : focused ? colors.primary : colors.onSurfaceVariant}
          style={styles.label}
        >
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.box,
          variant === 'filled'
            ? {
                backgroundColor: colors.surfaceContainerHighest,
                borderBottomWidth: focused ? 2 : 1,
                borderBottomColor: borderColor,
                borderTopLeftRadius: shape.extraSmall,
                borderTopRightRadius: shape.extraSmall,
              }
            : {
                borderWidth: focused ? 2 : 1,
                borderColor,
                borderRadius: shape.extraSmall,
              },
          !editable && { opacity: 0.5 },
          style,
        ]}
      >
        {leadingIcon ? (
          <Ionicons name={leadingIcon} size={20} color={colors.onSurfaceVariant} />
        ) : null}

        <TextInput
          style={[styles.input, typescale.bodyLarge, { color: colors.onSurface }]}
          placeholderTextColor={colors.outline}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          editable={editable}
          accessibilityLabel={label ?? rest.placeholder}
          accessibilityHint={errorText ?? supportingText}
          accessibilityState={{ disabled: !editable }}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />

        {trailingIcon ? (
          onTrailingIconPress ? (
            <Touchable
              onPress={onTrailingIconPress}
              stateLayerColor={colors.onSurfaceVariant}
              borderRadius={shape.full}
              accessibilityRole="button"
              accessibilityLabel={trailingIconLabel ?? 'Field action'}
              // 20dp icon: 14dp each side brings the target to the 48dp minimum.
              hitSlop={14}
            >
              <Ionicons name={trailingIcon} size={20} color={colors.onSurfaceVariant} />
            </Touchable>
          ) : (
            <Ionicons name={trailingIcon} size={20} color={colors.onSurfaceVariant} />
          )
        ) : null}
      </View>

      {errorText || supportingText ? (
        <Text
          variant="bodySmall"
          color={hasError ? colors.error : colors.onSurfaceVariant}
          style={styles.supporting}
          accessibilityLiveRegion={hasError ? 'polite' : 'none'}
        >
          {errorText ?? supportingText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.xs,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
    // RN Android adds its own baseline padding that fights the M3 metrics.
    textAlignVertical: 'center',
  },
  supporting: {
    marginTop: spacing.xs,
    marginLeft: spacing.lg,
  },
});

/* ------------------------------------------------------------------ *
 * Search bar
 * ------------------------------------------------------------------ */

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onClear?: () => void;
  onSubmitEditing?: () => void;
  autoFocus?: boolean;
  /** Rendered at the start — typically a back arrow once a query is active. */
  leading?: React.ReactNode;
  /** Rendered after the clear button — e.g. a filter toggle. */
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * Material 3 search bar: a fully rounded `surfaceContainerHigh` pill, drawn at
 * the app's density (48dp) rather than M3's roomier 56dp default.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  onFocus,
  onBlur,
  onClear,
  onSubmitEditing,
  autoFocus = false,
  leading,
  trailing,
  style,
  accessibilityLabel,
}: SearchFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        search.bar,
        {
          backgroundColor: colors.surfaceContainerHigh,
          borderColor: focused ? colors.primary : 'transparent',
        },
        style,
      ]}
    >
      {leading ?? <Ionicons name="search" size={24} color={colors.onSurfaceVariant} />}

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceVariant}
        style={[search.input, typescale.bodyLarge, { color: colors.onSurface }]}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        autoFocus={autoFocus}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        accessibilityRole="search"
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
      />

      {value.length > 0 ? (
        <Touchable
          onPress={() => {
            onChangeText('');
            onClear?.();
          }}
          stateLayerColor={colors.onSurfaceVariant}
          borderRadius={shape.full}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={12}
          style={search.clear}
        >
          <Ionicons name="close" size={22} color={colors.onSurfaceVariant} />
        </Touchable>
      ) : null}

      {trailing}
    </View>
  );
}

const search = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: density.searchBar,
    borderRadius: shape.full,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    borderWidth: 2,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    height: '100%',
  },
  clear: {
    padding: 2,
    borderRadius: shape.full,
    overflow: 'hidden',
  },
});
