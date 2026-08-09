import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
}: StatCardProps) {
  const { colors } = useTheme();
  const iconColor = color ?? colors.primary;

  return (
    <Card
      variant="filled"
      onPress={onPress}
      radius={shape.large}
      style={[styles.card, width ? { width } : styles.flexible]}
      accessibilityLabel={`${value} ${label}`}
      accessibilityHint={onPress ? `Opens ${label}` : undefined}
    >
      <View style={styles.body}>
        <View style={[styles.iconCircle, { backgroundColor: colors.surfaceContainerLow }]}>
          <Ionicons name={icon as any} size={20} color={iconColor} />
        </View>
        <Text variant="headlineSmall" color={colors.onSurface} numberOfLines={1}>
          {value}
        </Text>
        <Text variant="bodyMedium" color={colors.onSurfaceVariant} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 132,
  },
  flexible: {
    flex: 1,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
});
