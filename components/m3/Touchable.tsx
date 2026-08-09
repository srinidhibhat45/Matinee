import React, { useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { stateLayer, withAlpha } from '../../constants/m3';

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Colour of the state layer — the M3 "on" colour of whatever this control
   * sits on (e.g. `onSurface` for a plain surface, `onPrimary` for a filled
   * button). Drawn at the spec's 10% pressed opacity.
   */
  stateLayerColor: string;
  /** Corner radius, so the ripple and the state layer are clipped to shape. */
  borderRadius?: number;
  /** Set false for controls whose press feedback comes from elsewhere. */
  showStateLayer?: boolean;
}

/**
 * A Pressable that paints Material 3 press feedback.
 *
 * Android gets the platform ripple, which is what M3 specifies and what users
 * expect. Everywhere else — iOS, web — falls back to the same 10% state layer
 * rendered as an overlay, so the visual weight of a press matches across
 * platforms even though the animation differs.
 */
export default function Touchable({
  children,
  style,
  stateLayerColor,
  borderRadius = 0,
  showStateLayer = true,
  disabled,
  ...rest
}: TouchableProps) {
  const androidRipple = useMemo(
    () =>
      Platform.OS === 'android' && showStateLayer && !disabled
        ? { color: withAlpha(stateLayerColor, stateLayer.pressed), borderless: false, foreground: true }
        : undefined,
    [stateLayerColor, showStateLayer, disabled]
  );

  /**
   * React Native Web does not translate `accessibilityState` into ARIA
   * attributes, so a selected tab or checked chip reaches the browser with no
   * state at all. Mirroring the state into `aria-*` props fixes web without
   * disturbing native, which keeps reading `accessibilityState`.
   */
  const ariaProps = useMemo(() => {
    if (Platform.OS !== 'web') return null;
    const state = rest.accessibilityState;
    if (!state && !disabled) return null;
    return {
      'aria-selected': state?.selected,
      'aria-checked': state?.checked,
      'aria-busy': state?.busy,
      'aria-expanded': state?.expanded,
      'aria-disabled': state?.disabled ?? disabled ?? undefined,
    };
  }, [rest.accessibilityState, disabled]);

  return (
    <Pressable
      android_ripple={androidRipple}
      disabled={disabled}
      {...ariaProps}
      style={style}
      {...rest}
    >
      {({ pressed }: any) => (
        <>
          {typeof children === 'function' ? (children as any)({ pressed }) : children}
          {/* Android already draws the ripple, so the overlay would double it. */}
          {pressed && showStateLayer && !disabled && Platform.OS !== 'android' ? (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius,
                  backgroundColor: withAlpha(stateLayerColor, stateLayer.pressed),
                },
              ]}
            />
          ) : null}
        </>
      )}
    </Pressable>
  );
}
