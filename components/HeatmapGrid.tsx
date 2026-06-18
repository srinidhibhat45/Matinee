import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface HeatmapDataPoint {
  date: string; // 'YYYY-MM-DD'
  count: number;
}

interface HeatmapGridProps {
  data: HeatmapDataPoint[];
  year: number;
  onDayPress?: (date: string, count: number) => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_PADDING = 12; // padding of container View
const LEFT_LABEL_WIDTH = 20;
const RIGHT_GAP = 4;
const AVAILABLE_WIDTH = SCREEN_WIDTH - 40 - (GRID_PADDING * 2) - LEFT_LABEL_WIDTH - RIGHT_GAP;
const CELL_GAP = 1.2;
const CELL_TOTAL = AVAILABLE_WIDTH / 53;
const CELL_SIZE = CELL_TOTAL - CELL_GAP;

const DAY_LABELS = ['', 'M', '', 'W', '', 'F', ''] as const;
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function getColor(count: number, _colors: any): string {
  if (count === 0) return 'transparent';
  if (count === 1) return '#4D3800'; // dark amber
  if (count === 2) return '#806000'; // medium amber
  return '#FFBF00'; // full amber
}

export default function HeatmapGrid({
  data,
  year,
  onDayPress,
}: HeatmapGridProps) {
  const { colors } = useTheme();
  const { weeks, monthLabels, totalCount } = useMemo(() => {
    // Build a lookup map from date string to count
    const countMap = new Map<string, number>();
    for (const d of data) {
      countMap.set(d.date, d.count);
    }

    // Jan 1 of the given year
    const startDate = new Date(year, 0, 1);
    const startDay = startDate.getDay(); // 0=Sun, 1=Mon, ...

    // Dec 31
    const endDate = new Date(year, 11, 31);
    const totalDays =
      Math.floor(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

    // Build weeks (columns). Each week is an array of 7 day-slots.
    const allWeeks: (
      | { date: string; count: number; dayOfWeek: number }
      | null
    )[][] = [];
    let total = 0;

    // First week may have empty slots before Jan 1
    let currentWeek: (
      | { date: string; count: number; dayOfWeek: number }
      | null
    )[] = [];
    for (let i = 0; i < startDay; i++) {
      currentWeek.push(null);
    }

    for (let d = 0; d < totalDays; d++) {
      const current = new Date(year, 0, 1 + d);
      const dayOfWeek = current.getDay();
      const dateStr = formatDate(current);
      const count = countMap.get(dateStr) || 0;
      total += count;

      currentWeek.push({ date: dateStr, count, dayOfWeek });

      if (dayOfWeek === 6 || d === totalDays - 1) {
        // Fill remaining slots in last week
        while (currentWeek.length < 7) {
          currentWeek.push(null);
        }
        allWeeks.push(currentWeek);
        currentWeek = [];
      }
    }

    // Calculate month label positions
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

  return (
    <View style={styles.container}>
      {/* Month labels */}
      <View style={styles.monthRow}>
        <View style={styles.dayLabelSpacer} />
        <View style={[styles.monthLabelsInner, { width: weeks.length * CELL_TOTAL }]}>
          {monthLabels.map((m, i) => (
            <Text
              key={`${m.label}-${i}`}
              style={[
                styles.monthLabel,
                { left: m.weekIndex * CELL_TOTAL, color: colors.secondary },
              ]}
            >
              {m.label}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.gridRow}>
        {/* Day labels */}
        <View style={styles.dayLabels}>
          {DAY_LABELS.map((label, i) => (
            <View key={i} style={styles.dayLabelCell}>
              <Text style={[styles.dayLabelText, { color: colors.secondary }]}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Grid */}
        <View style={styles.gridContent}>
          {weeks.map((week, weekIdx) => (
            <View key={weekIdx} style={styles.weekColumn}>
              {week.map((cell, dayIdx) => {
                if (!cell) {
                  return (
                    <View
                      key={`empty-${dayIdx}`}
                      style={[styles.cell, styles.cellEmpty]}
                    />
                  );
                }
                const isGhost = cell.count === 0;
                return (
                  <Pressable
                    key={cell.date}
                    onPress={() => onDayPress?.(cell.date, cell.count)}
                    style={[
                      styles.cell,
                      isGhost
                        ? [styles.cellGhost, { borderColor: colors.border }]
                        : { backgroundColor: getColor(cell.count, colors) },
                    ]}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </View>

      {/* Summary */}
      <Text style={[styles.summary, { color: colors.secondary }]}>
        {totalCount} {totalCount === 1 ? 'movie' : 'movies'} this year
      </Text>
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
  container: {
    // No fixed width; parent controls layout
  },
  monthRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  dayLabelSpacer: {
    width: LEFT_LABEL_WIDTH,
  },
  monthLabelsInner: {
    height: 16,
    position: 'relative',
  },
  monthLabel: {
    position: 'absolute',
    fontSize: 9,
    top: 0,
  },
  gridRow: {
    flexDirection: 'row',
  },
  dayLabels: {
    width: LEFT_LABEL_WIDTH,
    marginRight: 2,
  },
  dayLabelCell: {
    height: CELL_TOTAL,
    justifyContent: 'center',
  },
  dayLabelText: {
    fontSize: 9,
  },
  gridContent: {
    flexDirection: 'row',
  },
  weekColumn: {
    marginRight: CELL_GAP,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 1.5,
    marginBottom: CELL_GAP,
  },
  cellEmpty: {
    backgroundColor: 'transparent',
  },
  cellGhost: {
    backgroundColor: 'transparent',
    borderWidth: 0.5,
  },
  summary: {
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
});
