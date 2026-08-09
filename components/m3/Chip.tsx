import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { shape, spacing, withAlpha, emphasisOpacity } from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';
import Text from './Text';
import Touchable from './Touchable';

export type ChipVariant = 'assist' | 'filter' | 'input' | 'suggestion';

export interface ChipProps {
  label: string;
  onPress?: () => void;
  /** Renders a trailing ✕ that removes the chip. Input chips only. */
  onRemove?: () => void;
  variant?: ChipVariant;
  selected?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  /** Elevated chips carry a level-1 shadow instead of an outline. */
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * Material 3 chip.
 *
 * `filter` chips announce themselves as checkboxes to screen readers, because
 * that is what they behave like — a set of independently toggleable options —
 * and it is the difference between "Action, button" and "Action, checked".
 */
export default function Chip({
  label,
  onPress,
  onRemove,
  variant = 'filter',
  selected = false,
  icon,
  disabled = false,
  elevated = false,
  style,
  accessibilityHint,
  testID,
}: ChipProps) {
  const { colors } = useTheme();

  const container: ViewStyle = disabled
    ? {
        backgroundColor: selected
          ? withAlpha(colors.onSurface, emphasisOpacity.disabledContainer)
          : 'transparent',
        borderWidth: selected ? 0 : 1,
        borderColor: withAlpha(colors.onSurface, emphasisOpacity.disabledContainer),
      }
    : selected
      ? { backgroundColor: colors.secondaryContainer, borderWidth: 0 }
      : elevated
        ? { backgroundColor: colors.surfaceContainerLow, borderWidth: 0 }
        : { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.outlineVariant };

  const content = disabled
    ? withAlpha(colors.onSurface, emphasisOpacity.disabledContent)
    : selected
      ? colors.onSecondaryContainer
      : colors.onSurfaceVariant;

  // A filter chip that is on shows a leading checkmark; that is the M3 pattern
  // and it keeps the state readable without relying on colour alone.
  const leadingIcon: keyof typeof Ionicons.glyphMap | undefined =
    variant === 'filter' && selected ? 'checkmark' : icon;

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      stateLayerColor={content}
      borderRadius={shape.small}
      accessibilityRole={variant === 'filter' ? 'checkbox' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, checked: variant === 'filter' ? selected : undefined, selected }}
      testID={testID}
      // M3 draws chips 32dp tall but still expects a 48dp target; the slop
      // makes up the difference without changing the visual height. Horizontal
      // slop stays under the 8dp inter-chip gap so neighbours can't overlap.
      hitSlop={{ top: 8, bottom: 8, left: 3, right: 3 }}
      style={[styles.chip, container, style]}
    >
      <View style={styles.row}>
        {leadingIcon ? <Ionicons name={leadingIcon} size={18} color={content} /> : null}
        <Text variant="labelLarge" color={content} numberOfLines={1}>
          {label}
        </Text>
        {onRemove ? (
          <Touchable
            onPress={onRemove}
            stateLayerColor={content}
            borderRadius={shape.full}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label}`}
            // 20dp icon: 14dp each side brings the target to the 48dp minimum.
            hitSlop={14}
            style={styles.remove}
          >
            <Ionicons name="close" size={16} color={content} />
          </Touchable>
        ) : null}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 32,
    borderRadius: shape.small,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  remove: {
    marginLeft: -2,
    marginRight: -4,
    padding: 2,
  },
});

/* ------------------------------------------------------------------ *
 * Segmented buttons
 * ------------------------------------------------------------------ */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Spoken label, for when `label` is abbreviated to fit the control. */
  a11yLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export interface SegmentedButtonsProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Announced before the option list, e.g. "Media type". */
  accessibilityLabel?: string;
  /** Compact height for dense contexts such as sheet headers. */
  dense?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Material 3 segmented buttons — a single-select control for 2–5 mutually
 * exclusive options. Replaces the ad-hoc pill "tab" rows the app used before,
 * which looked like filter chips but behaved like radio buttons.
 */
export function SegmentedButtons<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  dense = false,
  style,
}: SegmentedButtonsProps<T>) {
  const { colors } = useTheme();
  const height = dense ? 36 : 40;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[
        segmented.container,
        { borderColor: colors.outline, height, borderRadius: shape.full },
        style,
      ]}
    >
      {options.map((option, index) => {
        const isSelected = option.value === value;
        const content = isSelected ? colors.onSecondaryContainer : colors.onSurface;

        return (
          <React.Fragment key={option.value}>
            {index > 0 ? (
              <View style={{ width: 1, backgroundColor: colors.outline }} />
            ) : null}
            <Touchable
              onPress={() => onChange(option.value)}
              stateLayerColor={content}
              accessibilityRole="radio"
              accessibilityLabel={option.a11yLabel ?? option.label}
              accessibilityState={{ selected: isSelected, checked: isSelected }}
              // Segments render 36dp (dense) or 40dp tall; either way the
              // target is padded back out to the 48dp minimum.
              hitSlop={dense ? { top: 6, bottom: 6 } : { top: 4, bottom: 4 }}
              style={[
                segmented.segment,
                {
                  backgroundColor: isSelected ? colors.secondaryContainer : 'transparent',
                },
              ]}
            >
              <View style={segmented.row}>
                {isSelected ? (
                  <Ionicons name="checkmark" size={18} color={content} />
                ) : option.icon ? (
                  <Ionicons name={option.icon} size={18} color={content} />
                ) : null}
                <Text
                  variant="labelLarge"
                  color={content}
                  numberOfLines={1}
                  // Long labels shrink and ellipsise rather than pushing the
                  // whole control past its container.
                  style={segmented.label}
                >
                  {option.label}
                </Text>
              </View>
            </Touchable>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const segmented = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderWidth: 1,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  segment: {
    flex: 1,
    // No minWidth: segments have to be able to shrink, or a three-option
    // control overflows its row on a narrow phone.
    flexShrink: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  label: {
    flexShrink: 1,
    textAlign: 'center',
  },
});
