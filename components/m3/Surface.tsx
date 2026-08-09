import React from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { elevation, shape, type ElevationLevel } from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';

export interface SurfaceProps extends ViewProps {
  /** M3 elevation level 0–5. Also picks the matching surface-container tone. */
  level?: ElevationLevel;
  /** Overrides the tone chosen by `level`. */
  backgroundColor?: string;
  radius?: number;
  /** Draws a 1dp `outlineVariant` hairline — M3's outlined container style. */
  outlined?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The base container of the M3 surface system.
 *
 * In M3 elevation is expressed twice: as a shadow *and* as a lighter surface
 * tone. Dark themes lean almost entirely on the tone, because shadows are
 * nearly invisible against a near-black background — so both are derived from
 * the single `level` prop here rather than being set independently at each
 * call site.
 */
export default function Surface({
  level = 0,
  backgroundColor,
  radius = shape.medium,
  outlined = false,
  style,
  children,
  ...rest
}: SurfaceProps) {
  const { colors } = useTheme();

  const TONE_BY_LEVEL = [
    colors.surface,
    colors.surfaceContainerLow,
    colors.surfaceContainer,
    colors.surfaceContainerHigh,
    colors.surfaceContainerHigh,
    colors.surfaceContainerHighest,
  ];

  return (
    <View
      style={[
        {
          backgroundColor: backgroundColor ?? TONE_BY_LEVEL[level],
          borderRadius: radius,
          ...elevation(level, colors.shadow),
        },
        outlined && { borderWidth: 1, borderColor: colors.outlineVariant },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
