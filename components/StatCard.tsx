import React from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { shape, spacing } from '../constants/m3';
import { useTheme } from '../context/ThemeContext';
import { Card, Text } from './m3';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  color?: string;
  onPress?: () => void;
  /** Set by the responsive grid; omit to let the card fill its parent. */
  width?: number;
  /**
   * A short qualifier under the label, for a figure that is known to be
   * partial. Saying so is better than showing a confidently wrong number.
   */
  note?: string;
}

/**
 * A single metric tile.
 *
 * Value and label are combined into one accessibility label ("42 films
 * watched") because reading them as two nodes — "42", then "Films watched" —
 * loses the connection between them.
 */
export default function StatCard({
  label,
  value,
  icon,
  color,
  onPress,
  width,
  note,
}: StatCardProps) {
  const { colors } = useTheme();
  const iconColor = color ?? colors.primary;

  return (
    <Card
      variant="filled"
      onPress={onPress}
      radius={shape.large}
      style={[styles.card, width ? { width } : styles.flexible]}
      accessibilityLabel={[`${value} ${label}`, note].filter(Boolean).join(', ')}
      accessibilityHint={onPress ? `Opens ${label}` : undefined}
    >
      <View style={styles.body}>
        <View style={[styles.iconCircle, { backgroundColor: colors.surfaceContainerLow }]}>
          <Ionicons name={icon as any} size={18} color={iconColor} />
        </View>
        <Text variant="headlineSmall" color={colors.onSurface} numberOfLines={1}>
          {value}
        </Text>
        <Text variant="bodyMedium" color={colors.onSurfaceVariant} numberOfLines={2}>
          {label}
        </Text>
        {note ? (
          <Text variant="labelSmall" color={colors.outline} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 104,
  },
  flexible: {
    flex: 1,
  },
  body: {
    padding: spacing.md,
    gap: 1,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
