import type { DateKey, Habit, Schedule } from '../types';
import { WEEKDAY_SHORT, weekday } from './dates';

export const isWeekly = (s: Schedule): s is { type: 'weekly'; times: number } => s.type === 'weekly';

/** Daily and weekday schedules have specific due days; weekly ("N times a week") are flexible. */
export function isScheduledOn(schedule: Schedule, date: DateKey): boolean {
  switch (schedule.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return schedule.days.includes(weekday(date));
    case 'weekly':
      return true;
  }
}

export function describeSchedule(s: Schedule): string {
  switch (s.type) {
    case 'daily':
      return 'Every day';
    case 'weekdays': {
      const days = [...s.days].sort((a, b) => a - b);
      if (days.length === 7) return 'Every day';
      if (days.join() === '1,2,3,4,5') return 'Weekdays';
      if (days.join() === '0,6') return 'Weekends';
      return days.map((d) => WEEKDAY_SHORT[d]).join(', ');
    }
    case 'weekly':
      return `${s.times}× per week`;
  }
}

export function describeGoal(h: Pick<Habit, 'goal'>): string {
  return h.goal ? `${h.goal.target} ${h.goal.unit}`.trim() : '';
}
