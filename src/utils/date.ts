export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function getDateRange(days: number): { startDate: string; endDate: string } {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1); // Yesterday (GSC data is delayed)

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days + 1);

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate)
  };
}

export function getDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDate(date);
}

export function isValidDateRange(startDate: string, endDate: string): boolean {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  // Check if dates are valid
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return false;
  }

  // End date must be after or equal to start date
  if (end < start) {
    return false;
  }

  // GSC data is available for the last 16 months
  const sixteenMonthsAgo = new Date();
  sixteenMonthsAgo.setMonth(sixteenMonthsAgo.getMonth() - 16);

  if (start < sixteenMonthsAgo) {
    return false;
  }

  // Can't query future dates
  const today = new Date();
  if (end > today) {
    return false;
  }

  return true;
}

export function getComparisonPeriods(
  period: '7d' | '28d' | '90d'
): { current: { start: string; end: string }; previous: { start: string; end: string } } {
  const periodDays = period === '7d' ? 7 : period === '28d' ? 28 : 90;

  const currentEnd = new Date();
  currentEnd.setDate(currentEnd.getDate() - 1); // Yesterday

  const currentStart = new Date(currentEnd);
  currentStart.setDate(currentStart.getDate() - periodDays + 1);

  const previousEnd = new Date(currentStart);
  previousEnd.setDate(previousEnd.getDate() - 1);

  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - periodDays + 1);

  return {
    current: {
      start: formatDate(currentStart),
      end: formatDate(currentEnd)
    },
    previous: {
      start: formatDate(previousStart),
      end: formatDate(previousEnd)
    }
  };
}
