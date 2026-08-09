import React, { useMemo, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { shape, spacing, withAlpha } from '../constants/m3';
import { useTheme } from '../context/ThemeContext';
import { Text, Touchable } from './m3';

interface HeatmapDataPoint {
  date: string; // 'YYYY-MM-DD'
  count: number;
}

interface HeatmapGridProps {
  data: HeatmapDataPoint[];
  year: number;
  onDayPress?: (date: string, count: number) => void;
}

const LEFT_LABEL_WIDTH = 18;
const CELL_GAP = 2;
const WEEKS_IN_YEAR = 53;

const DAY_LABELS = ['', 'M', '', 'W', '', 'F', ''] as const;
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Four-step intensity ramp built from the theme's primary tone.
 *
 * The previous version hardcoded amber for both schemes, so the low steps
 * disappeared entirely against a light background. Deriving the steps from
 * `primary` keeps them visible in either theme and ties the chart to the rest
 * of the palette.
 */
function useIntensityScale() {
  const { colors, isDark } = useTheme();
  return useMemo(
    () => ({
      empty: withAlpha(colors.onSurfaceVariant, isDark ? 0.1 : 0.14),
      steps: [
        withAlpha(colors.primary, isDark ? 0.3 : 0.28),
        withAlpha(colors.primary, isDark ? 0.58 : 0.55),
        colors.primary,
      ],
    }),
    [colors, isDark]
  );
}

/**
 * GitHub-style contribution grid for a year of viewing activity.
 *
 * Cell size is derived from the measured container width rather than the
 * device width read at import time, so the grid fits correctly after rotation,
 * on a foldable, and inside the narrower column of a wide layout.
 */
export default function HeatmapGrid({ data, year, onDayPress }: HeatmapGridProps) {
  const { colors } = useTheme();
  const scale = useIntensityScale();
  const [containerWidth, setContainerWidth] = useState(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (Math.abs(next - containerWidth) > 1) setContainerWidth(next);
  };

  const cellTotal = containerWidth
    ? (containerWidth - LEFT_LABEL_WIDTH - spacing.xs) / WEEKS_IN_YEAR
    : 0;
  const cellSize = Math.max(0, cellTotal - CELL_GAP);

  const { weeks, monthLabels, totalCount } = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const d of data) countMap.set(d.date, d.count);

    const startDate = new Date(year, 0, 1);
    const startDay = startDate.getDay(); // 0 = Sunday
    const endDate = new Date(year, 11, 31);
    const totalDays =
      Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    type Cell = { date: string; count: number } | null;
    const allWeeks: Cell[][] = [];
    let total = 0;

    let currentWeek: Cell[] = [];
    for (let i = 0; i < startDay; i++) currentWeek.push(null);

    for (let d = 0; d < totalDays; d++) {
      const current = new Date(year, 0, 1 + d);
      const dateStr = formatDate(current);
      const count = countMap.get(dateStr) || 0;
      total += count;
      currentWeek.push({ date: dateStr, count });

      if (current.getDay() === 6 || d === totalDays - 1) {
        while (currentWeek.length < 7) currentWeek.push(null);
        allWeeks.push(currentWeek);
        currentWeek = [];
      }
    }

    const labels: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < allWeeks.length; w++) {
      for (const cell of allWeeks[w]) {
        if (cell) {
          const month = parseInt(cell.date.substring(5, 7), 10) - 1;
          if (month !== lastMonth) {
            labels.push({ label: MONTH_NAMES[month], weekIndex: w });
            lastMonth = month;
          }
          break;
        }
      }
    }

    return { weeks: allWeeks, monthLabels: labels, totalCount: total };
  }, [data, year]);

  // A month spans ~4.3 columns. When that is narrower than a three-letter
  // label, every other month is dropped so the row reads cleanly instead of
  // running together as "FebMar".
  const monthLabelWidth = 26;
  const showEveryOtherMonth = cellTotal * 4.3 < monthLabelWidth;
  const visibleMonthLabels = showEveryOtherMonth
    ? monthLabels.filter((_, i) => i % 2 === 0)
    : monthLabels;

  const cellColor = (count: number) => {
    if (count === 0) return scale.empty;
    if (count === 1) return scale.steps[0];
    if (count === 2) return scale.steps[1];
    return scale.steps[2];
  };

  return (
    <View onLayout={handleLayout}>
      {cellSize > 0 ? (
        <>
          {/* Month labels */}
          <View style={styles.monthRow}>
            <View style={{ width: LEFT_LABEL_WIDTH }} />
            <View style={[styles.monthLabels, { width: weeks.length * cellTotal }]}>
              {visibleMonthLabels.map((m, i) => (
                <Text
                  key={`${m.label}-${i}`}
                  variant="labelSmall"
                  color={colors.onSurfaceVariant}
                  maxFontSizeMultiplier={1.1}
                  style={[styles.monthLabel, { left: m.weekIndex * cellTotal }]}
                >
                  {m.label}
                </Text>
              ))}
            </View>
          </View>

          <View
            style={styles.gridRow}
            // The grid is decorative in aggregate; the summary below carries
            // the number, so screen readers get one useful sentence instead of
            // 365 unlabelled cells.
            accessibilityRole="image"
            accessibilityLabel={`Activity heatmap for ${year}. ${totalCount} ${
              totalCount === 1 ? 'title' : 'titles'
            } logged.`}
          >
            <View style={{ width: LEFT_LABEL_WIDTH }}>
              {DAY_LABELS.map((label, i) => (
                <View key={i} style={{ height: cellTotal, justifyContent: 'center' }}>
                  <Text
                    variant="labelSmall"
                    color={colors.onSurfaceVariant}
                    maxFontSizeMultiplier={1.1}
                  >
                    {label}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.grid}>
              {weeks.map((week, weekIdx) => (
                <View key={weekIdx} style={{ marginRight: CELL_GAP }}>
                  {week.map((cell, dayIdx) =>
                    cell ? (
                      <Touchable
                        key={cell.date}
                        onPress={onDayPress ? () => onDayPress(cell.date, cell.count) : undefined}
                        stateLayerColor={colors.onSurface}
                        showStateLayer={!!onDayPress}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                        style={{
                          width: cellSize,
                          height: cellSize,
                          borderRadius: 2,
                          marginBottom: CELL_GAP,
                          backgroundColor: cellColor(cell.count),
                        }}
                      />
                    ) : (
                      <View
                        key={`empty-${weekIdx}-${dayIdx}`}
                        style={{ width: cellSize, height: cellSize, marginBottom: CELL_GAP }}
                      />
                    )
                  )}
                </View>
              ))}
            </View>
          </View>

          {/* Legend */}
          <View style={styles.footer}>
            <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
              {totalCount} {totalCount === 1 ? 'title' : 'titles'} this year
            </Text>
            <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no">
              <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                Less
              </Text>
              {[scale.empty, ...scale.steps].map((color, i) => (
                <View key={i} style={[styles.legendCell, { backgroundColor: color }]} />
              ))}
              <Text variant="labelSmall" color={colors.onSurfaceVariant}>
                More
              </Text>
            </View>
          </View>
        </>
      ) : (
        // Reserve height on the first pass so the card doesn't jump once the
        // width is measured.
        <View style={styles.measurePlaceholder} />
      )}
    </View>
  );
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const styles = StyleSheet.create({
  monthRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  monthLabels: {
    height: 16,
    position: 'relative',
  },
  monthLabel: {
    position: 'absolute',
    top: 0,
  },
  gridRow: {
    flexDirection: 'row',
  },
  grid: {
    flexDirection: 'row',
  },
  footer: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendCell: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  measurePlaceholder: {
    height: 120,
  },
});
