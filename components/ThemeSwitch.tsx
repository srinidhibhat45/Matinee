import React, { useEffect, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

export default function ThemeSwitch() {
  const { theme, toggleTheme, colors, isDark } = useTheme();
  const slideAnim = useRef(new Animated.Value(isDark ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isDark ? 1 : 0,
      duration: 250,
      easing: Easing.bezier(0.25, 1, 0.5, 1),
      useNativeDriver: true,
    }).start();
  }, [isDark, slideAnim]);

  // Translate calculation
  // Container width is 76, padding is 3, pill width is 30.
  // Translate range is from 0 (left - light mode) to 40 (right - dark mode)
  const translateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 40],
  });

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={toggleTheme}
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      {/* Sliding Pill */}
      <Animated.View
        style={[
          styles.pill,
          {
            transform: [{ translateX }],
            backgroundColor: isDark ? colors.accent : colors.text,
            shadowColor: isDark ? colors.accent : '#000000',
            shadowOpacity: isDark ? 0.3 : 0.1,
            shadowRadius: isDark ? 6 : 3,
            elevation: 3,
          },
        ]}
      />

      {/* Sun Icon (Light) */}
      <View style={styles.iconWrapper}>
        <Ionicons
          name="sunny-outline"
          size={16}
          color={isDark ? colors.muted : colors.bg}
        />
      </View>

      {/* Moon Icon (Dark) */}
      <View style={styles.iconWrapper}>
        <Ionicons
          name="moon-outline"
          size={16}
          color={isDark ? colors.bg : colors.muted}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 76,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    left: 3,
    width: 30,
    height: 28,
    borderRadius: 14,
    shadowOffset: { width: 0, height: 1 },
  },
  iconWrapper: {
    width: 34,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
});
