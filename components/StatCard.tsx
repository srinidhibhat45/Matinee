import React from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Screen horizontal padding: 16 * 2 = 32. Column gap: 10.
const CARD_WIDTH = (SCREEN_WIDTH - 32 - 10) / 2;

interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  color?: string;
  onPress?: () => void;
}

export default function StatCard({
  label,
  value,
  icon,
  color,
  onPress,
}: StatCardProps) {
  const { colors } = useTheme();
  const iconColor = color || colors.accent;

  const CardContainer = onPress ? TouchableOpacity : View;

  return (
    <CardContainer
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.card, { width: CARD_WIDTH, backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Ionicons
        name={icon as any}
        size={22}
        color={iconColor}
        style={styles.icon}
      />
      <Text style={[styles.value, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.label, { color: colors.secondary }]}>{label}</Text>
    </CardContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  icon: {
    marginBottom: 12,
  },
  value: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  label: {
    fontSize: 13,
  },
});
