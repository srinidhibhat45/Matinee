import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { density, spacing } from '../../constants/m3';
import { useTheme } from '../../context/ThemeContext';
import Text from './Text';
import Touchable from './Touchable';

export interface ListItemProps {
  headline: string;
  supportingText?: string;
  overline?: string;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  leadingIconColor?: string;
  /** Arbitrary leading content — an avatar or thumbnail. Wins over the icon. */
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  trailingText?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Selected rows tint to `secondaryContainer`, per M3 list selection. */
  selected?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  accessibilityRole?: 'button' | 'menuitem' | 'switch' | 'checkbox' | 'link';
  accessibilityState?: { checked?: boolean; selected?: boolean; disabled?: boolean };
  testID?: string;
}

/**
 * Material 3 list item — one, two or three lines depending on what is supplied.
 *
 * Row heights come from the app's density scale rather than M3's default
 * 56/72/88, which wastes vertical space in the long settings and picker lists
 * this app uses. Every step still clears the 48dp touch target. The whole row
 * is one accessibility node, so a screen reader announces "Title, supporting
 * text" instead of stopping twice.
 */
export default function ListItem({
  headline,
  supportingText,
  overline,
  leadingIcon,
  leadingIconColor,
  leading,
  trailing,
  trailingIcon,
  trailingText,
  onPress,
  disabled = false,
  selected = false,
  destructive = false,
  style,
  accessibilityHint,
  accessibilityRole = 'button',
  accessibilityState,
  testID,
}: ListItemProps) {
  const { colors } = useTheme();

  const lines = 1 + (supportingText ? 1 : 0) + (overline ? 1 : 0);
  const minHeight =
    lines >= 3
      ? density.listItem.threeLine
      : lines === 2
        ? density.listItem.twoLine
        : density.listItem.oneLine;

  const headlineColor = disabled
    ? colors.outline
    : destructive
      ? colors.error
      : selected
        ? colors.onSecondaryContainer
        : colors.onSurface;
  const supportColor = disabled ? colors.outline : selected ? colors.onSecondaryContainer : colors.onSurfaceVariant;
  const iconColor = leadingIconColor ?? (destructive ? colors.error : supportColor);

  const body = (
    <View style={[styles.row, { minHeight }]}>
      {leading ?? (leadingIcon ? (
        <Ionicons name={leadingIcon} size={24} color={iconColor} style={styles.leadingIcon} />
      ) : null)}

      <View style={styles.textWrap}>
        {overline ? (
          <Text variant="labelSmall" color={supportColor} numberOfLines={1}>
            {overline}
          </Text>
        ) : null}
        <Text variant="bodyLarge" color={headlineColor} numberOfLines={2}>
          {headline}
        </Text>
        {supportingText ? (
          <Text variant="bodyMedium" color={supportColor} numberOfLines={2}>
            {supportingText}
          </Text>
        ) : null}
      </View>

      {trailingText ? (
        <Text variant="labelSmall" color={supportColor} numberOfLines={1}>
          {trailingText}
        </Text>
      ) : null}
      {trailing ??
        (trailingIcon ? (
          <Ionicons name={trailingIcon} size={24} color={supportColor} />
        ) : null)}
    </View>
  );

  const containerStyle: StyleProp<ViewStyle> = [
    styles.container,
    selected && { backgroundColor: colors.secondaryContainer },
    style,
  ];

  if (!onPress) {
    return <View style={containerStyle}>{body}</View>;
  }

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      stateLayerColor={headlineColor}
      accessibilityRole={accessibilityRole}
      // One combined label so the row is announced as a single item.
      accessibilityLabel={[overline, headline, supportingText].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected, ...accessibilityState }}
      testID={testID}
      style={containerStyle}
    >
      {body}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.lg,
  },
  leadingIcon: {
    width: 24,
    textAlign: 'center',
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
});

/* ------------------------------------------------------------------ *
 * Divider
 * ------------------------------------------------------------------ */

export interface DividerProps {
  /** Left indent, matching the text column of an adjacent list item. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
}

export function Divider({ inset = 0, style }: DividerProps) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        {
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.outlineVariant,
          marginLeft: inset,
        },
        style,
      ]}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Section header
 * ------------------------------------------------------------------ */

export interface SectionHeaderProps {
  title: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Titles a group of content and exposes it to screen readers as a heading. */
export function SectionHeader({ title, action, style }: SectionHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={[section.row, style]}>
      <Text
        variant="titleMedium"
        color={colors.onSurfaceVariant}
        accessibilityRole="header"
        style={section.title}
      >
        {title}
      </Text>
      {action}
    </View>
  );
}

const section = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  title: {
    flexShrink: 1,
  },
});
