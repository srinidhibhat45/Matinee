import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ThemeColors {
  bg: string;
  card: string;
  elevated: string;
  text: string;
  secondary: string;
  muted: string;
  accent: string;
  accentMuted: string;
  border: string;
}

export const darkColors: ThemeColors = {
  bg: '#0A0A0C',
  card: '#141416',
  elevated: '#1E1E22',
  text: '#FFFFFF',
  secondary: '#B0B0B5',
  muted: '#929296',
  accent: '#EC407A',
  accentMuted: 'rgba(236, 64, 122, 0.15)',
  border: '#222225',
};

export const lightColors: ThemeColors = {
  bg: '#F5F5F7',
  card: '#FFFFFF',
  elevated: '#FFFFFF',
  text: '#000000',
  secondary: '#555559',
  muted: '#7C7C80',
  accent: '#C52F82',
  accentMuted: 'rgba(197, 47, 130, 0.12)',
  border: '#E5E5EA',
};

interface ThemeContextType {
  theme: 'dark' | 'light';
  colors: ThemeColors;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  colors: darkColors,
  toggleTheme: () => {},
  isDark: true,
});

const THEME_STORAGE_KEY = 'matinee_user_theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    // Load saved theme preference
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme === 'dark' || savedTheme === 'light') {
          setTheme(savedTheme);
        } else if (systemScheme === 'light' || systemScheme === 'dark') {
          setTheme(systemScheme);
        }
      } catch (err) {
        console.error('Failed to load theme preference', err);
      }
    };
    loadTheme();
  }, [systemScheme]);

  const toggleTheme = async () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (err) {
      console.error('Failed to save theme preference', err);
    }
  };

  const colors = theme === 'dark' ? darkColors : lightColors;
  const isDark = theme === 'dark';

  return (
    <ThemeContext.Provider value={{ theme, colors, toggleTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
