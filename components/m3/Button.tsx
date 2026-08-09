import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  elevation,
  emphasisOpacity,
  shape,
  spacing,
  typescale,
  withAlpha,
  MIN_TOUCH_TARGET,
} from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';
import Text from './Text';
import Touchable from './Touchable';

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';
export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Places the icon after the label — for "next"/"open" style affordances. */
  trailingIcon?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** Stretches to fill the parent's cross axis. */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

const SIZE = {
  small: { height: 32, paddingH: 12, gap: 6, icon: 16, variant: 'labelMedium' as const },
  medium: { height: 40, paddingH: 24, gap: 8, icon: 18, variant: 'labelLarge' as const },
  large: { height: 48, paddingH: 28, gap: 8, icon: 20, variant: 'labelLarge' as const },
};

/**
 * Material 3 common button.
 *
 * The five variants map to M3's emphasis ladder — `filled` for the single
 * primary action on a screen, `tonal` for a strong secondary, `outlined` and
 * `text` for everything quieter.
 */
export default function Button({
  label,
  onPress,
  variant = 'filled',
  size = 'medium',
  icon,
  trailingIcon = false,
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();
  const dims = SIZE[size];
  const isDisabled = disabled || loading;

  const { container, content, stateLayerColor } = useMemo(() => {
    if (isDisabled) {
      const disabledContent = withAlpha(colors.onSurface, emphasisOpacity.disabledContent);
      const disabledContainer = withAlpha(colors.onSurface, emphasisOpacity.disabledContainer);
      switch (variant) {
        case 'outlined':
          return {
            container: {
              backgroundColor: 'transparent',
              borderWidth: 1,
              borderColor: withAlpha(colors.onSurface, emphasisOpacity.disabledContainer),
            },
            content: disabledContent,
            stateLayerColor: colors.onSurface,
          };
        case 'text':
          return {
            container: { backgroundColor: 'transparent' },
            content: disabledContent,
            stateLayerColor: colors.onSurface,
          };
        default:
          return {
            container: { backgroundColor: disabledContainer },
            content: disabledContent,
            stateLayerColor: colors.onSurface,
          };
      }
    }

    switch (variant) {
      case 'filled':
        return {
          container: { backgroundColor: colors.primary },
          content: colors.onPrimary,
          stateLayerColor: colors.onPrimary,
        };
      case 'tonal':
        return {
          container: { backgroundColor: colors.secondaryContainer },
          content: colors.onSecondaryContainer,
          stateLayerColor: colors.onSecondaryContainer,
        };
      case 'outlined':
        return {
          container: {
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderColor: colors.outline,
          },
          content: colors.primary,
          stateLayerColor: colors.primary,
        };
      case 'text':
        return {
          container: { backgroundColor: 'transparent' },
          content: colors.primary,
          stateLayerColor: colors.primary,
        };
      case 'elevated':
        return {
          container: {
            backgroundColor: colors.surfaceContainerLow,
            ...elevation(1, colors.shadow),
          },
          content: colors.primary,
          stateLayerColor: colors.primary,
        };
    }
  }, [variant, isDisabled, colors]);

  const iconNode = icon ? (
    <Ionicons name={icon} size={dims.icon} color={content} />
  ) : null;

  return (
    <Touchable
      onPress={onPress}
      disabled={isDisabled}
      stateLayerColor={stateLayerColor}
      borderRadius={shape.full}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      // The 32dp `small` button is on-spec visually but under the 48dp target
      // minimum, so it gets slop to make up the shortfall.
      hitSlop={
        dims.height < MIN_TOUCH_TARGET
          ? { top: 8, bottom: 8, left: 4, right: 4 }
          : undefined
      }
      style={[
        styles.base,
        container,
        {
          height: dims.height,
          // `text` buttons sit flush with surrounding content, so they use a
          // tighter gutter — M3 gives them 12dp instead of the full 24dp.
          paddingHorizontal: variant === 'text' ? spacing.md : dims.paddingH,
          minWidth: MIN_TOUCH_TARGET,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      <View style={[styles.row, { gap: dims.gap }]}>
        {loading ? (
          <ActivityIndicator size="small" color={content} />
        ) : (
          <>
            {!trailingIcon && iconNode}
            <Text
              variant={dims.variant}
              color={content}
              numberOfLines={1}
              style={styles.label}
            >
              {label}
            </Text>
            {trailingIcon && iconNode}
          </>
        )}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
    flexShrink: 1,
  },
});

/* ------------------------------------------------------------------ *
 * Icon button
 * ------------------------------------------------------------------ */

export type IconButtonVariant = 'standard' | 'filled' | 'tonal' | 'outlined';

export interface IconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  variant?: IconButtonVariant;
  /** Visual diameter. The touch target is padded to 48dp regardless. */
  size?: number;
  iconSize?: number;
  disabled?: boolean;
  /** Marks the control as a toggle and drives its selected styling. */
  selected?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * Material 3 icon button. Always at least a 48dp target, even when the visible
 * circle is smaller — an icon-only control is the easiest thing to under-size.
 */
export function IconButton({
  icon,
  onPress,
  variant = 'standard',
  size = MIN_TOUCH_TARGET,
  iconSize = 24,
  disabled = false,
  selected,
  color,
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: IconButtonProps) {
  const { colors } = useTheme();

  const { container, content } = useMemo(() => {
    if (disabled) {
      return {
        container:
          variant === 'filled' || variant === 'tonal'
            ? { backgroundColor: withAlpha(colors.onSurface, emphasisOpacity.disabledContainer) }
            : variant === 'outlined'
              ? {
                  borderWidth: 1,
                  borderColor: withAlpha(colors.onSurface, emphasisOpacity.disabledContainer),
                }
              : {},
        content: withAlpha(colors.onSurface, emphasisOpacity.disabledContent),
      };
    }

    switch (variant) {
      case 'filled':
        return selected === false
          ? { container: { backgroundColor: colors.surfaceContainerHighest }, content: colors.primary }
          : { container: { backgroundColor: colors.primary }, content: colors.onPrimary };
      case 'tonal':
        return selected === false
          ? {
              container: { backgroundColor: colors.surfaceContainerHighest },
              content: colors.onSurfaceVariant,
            }
          : {
              container: { backgroundColor: colors.secondaryContainer },
              content: colors.onSecondaryContainer,
            };
      case 'outlined':
        return selected
          ? { container: { backgroundColor: colors.inverseSurface }, content: colors.inverseOnSurface }
          : {
              container: { borderWidth: 1, borderColor: colors.outline },
              content: colors.onSurfaceVariant,
            };
      default:
        return {
          container: {},
          content: color ?? (selected ? colors.primary : colors.onSurfaceVariant),
        };
    }
  }, [variant, selected, disabled, color, colors]);

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      stateLayerColor={content}
      borderRadius={shape.full}
      accessibilityRole={selected === undefined ? 'button' : 'togglebutton'}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected }}
      testID={testID}
      style={[
        {
          width: size,
          height: size,
          borderRadius: shape.full,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        container,
        style,
      ]}
      // Restores a full 48dp target when the visible circle is drawn smaller.
      hitSlop={
        size < MIN_TOUCH_TARGET ? Math.ceil((MIN_TOUCH_TARGET - size) / 2) : undefined
      }
    >
      <Ionicons name={icon} size={iconSize} color={content} />
    </Touchable>
  );
}

/* ------------------------------------------------------------------ *
 * FAB
 * ------------------------------------------------------------------ */

export interface FABProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  /** Renders the extended FAB with a visible label beside the icon. */
  label?: string;
  size?: 'small' | 'medium' | 'large';
  /** M3 FAB colour roles. `surface` is the low-emphasis variant. */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'surface';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled?: boolean;
  testID?: string;
}

const FAB_SIZE = {
  small: { box: 40, icon: 24, radius: shape.medium },
  medium: { box: 56, icon: 24, radius: shape.large },
  large: { box: 96, icon: 36, radius: shape.extraLarge },
};

export function FAB({
  icon,
  onPress,
  label,
  size = 'medium',
  variant = 'primary',
  style,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  testID,
}: FABProps) {
  const { colors } = useTheme();
  const dims = FAB_SIZE[size];

  const { bg, fg } = useMemo(() => {
    switch (variant) {
      case 'secondary':
        return { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer };
      case 'tertiary':
        return { bg: colors.tertiaryContainer, fg: colors.onTertiaryContainer };
      case 'surface':
        return { bg: colors.surfaceContainerHigh, fg: colors.primary };
      default:
        return { bg: colors.primaryContainer, fg: colors.onPrimaryContainer };
    }
  }, [variant, colors]);

  const extended = !!label;

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      stateLayerColor={fg}
      borderRadius={dims.radius}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
      style={[
        {
          height: dims.box,
          minWidth: dims.box,
          borderRadius: dims.radius,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: extended ? spacing.md : 0,
          paddingHorizontal: extended ? spacing.lg : 0,
          overflow: 'hidden',
          ...elevation(3, colors.shadow),
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={dims.icon} color={fg} />
      {extended ? (
        <Text variant="labelLarge" color={fg} numberOfLines={1} style={typescale.labelLarge}>
          {label}
        </Text>
      ) : null}
    </Touchable>
  );
}
