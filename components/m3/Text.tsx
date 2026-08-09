import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { typescale, type TypescaleRole } from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';

export interface TextProps extends RNTextProps {
  /** M3 type-scale role. Defaults to `bodyMedium`. */
  variant?: TypescaleRole;
  /** M3 colour role name, or any explicit colour string. Defaults to `onSurface`. */
  color?: string;
  /** Raises the weight without disturbing the role's size or line height. */
  weight?: TextStyle['fontWeight'];
  /** Caps how far OS font scaling may enlarge this text. */
  maxFontSizeMultiplier?: number;
}

/**
 * Text bound to the M3 type scale.
 *
 * Using this instead of a raw `<Text>` keeps sizes, line heights and letter
 * spacing on-spec, and means OS font-size scaling is honoured everywhere
 * (React Native's default `allowFontScaling` is preserved) rather than being
 * disabled ad hoc.
 */
export default function Text({
  variant = 'bodyMedium',
  color,
  weight,
  style,
  maxFontSizeMultiplier = 1.6,
  ...rest
}: TextProps) {
  const { colors } = useTheme();
  const resolved = color ?? colors.onSurface;

  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[typescale[variant], { color: resolved }, weight ? { fontWeight: weight } : null, style]}
      {...rest}
    />
  );
}
