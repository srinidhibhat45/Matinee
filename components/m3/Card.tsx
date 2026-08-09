import React from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { elevation, shape } from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';
import Touchable from './Touchable';

export type CardVariant = 'elevated' | 'filled' | 'outlined';

export interface CardProps extends Omit<ViewProps, 'style'> {
  variant?: CardVariant;
  onPress?: () => void;
  onLongPress?: () => void;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
  testID?: string;
}

/**
 * Material 3 card.
 *
 * `elevated` floats on a shadow, `filled` uses the highest surface tone with no
 * shadow, `outlined` is flat with a hairline. Interactive cards get real press
 * feedback and a button role instead of being a tappable `View`.
 */
export default function Card({
  variant = 'filled',
  onPress,
  onLongPress,
  radius = shape.medium,
  style,
  children,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  testID,
  ...rest
}: CardProps) {
  const { colors } = useTheme();

  const container: ViewStyle =
    variant === 'elevated'
      ? { backgroundColor: colors.surfaceContainerLow, ...elevation(1, colors.shadow) }
      : variant === 'outlined'
        ? {
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.outlineVariant,
          }
        : { backgroundColor: colors.surfaceContainerHighest };

  const base: StyleProp<ViewStyle> = [
    { borderRadius: radius, overflow: 'hidden' },
    container,
    style,
  ];

  if (!onPress && !onLongPress) {
    return (
      <View style={base} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      stateLayerColor={colors.onSurface}
      borderRadius={radius}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
      style={base}
      {...rest}
    >
      {children}
    </Touchable>
  );
}
