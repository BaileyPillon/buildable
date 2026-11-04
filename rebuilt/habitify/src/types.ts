export type DateKey = string; // local calendar date, "YYYY-MM-DD"

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'anytime';
export const TIMES_OF_DAY: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'anytime'];
export const TIME_LABELS: Record<TimeOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime',
};

export type Schedule =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] } // 0 = Sunday .. 6 = Saturday
  | { type: 'weekly'; times: number }; // N times per week, 1..7

export interface Goal {
  target: number;
  unit: string;
}

export interface Reminder {
  enabled: boolean;
  time: string; // "HH:MM" local
}

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  color: string;
  schedule: Schedule;
  goal?: Goal;
  timeOfDay: TimeOfDay;
  order: number;
  archived: boolean;
  createdAt: DateKey;
  reminder?: Reminder;
  externalId?: string; // id in a source app (e.g. Habitify) so re-imports merge
}

export type EntryStatus = 'done' | 'skipped' | 'none';

export interface Entry {
  key: string; // `${habitId}|${date}`
  habitId: string;
  date: DateKey;
  status: EntryStatus;
  value?: number; // numeric progress for goal habits
  note?: string;
  updatedAt: number;
}

export type EntryMap = Record<DateKey, Entry>;

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePref;
  weekStart: 0 | 1; // 0 = Sunday, 1 = Monday
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system', weekStart: 1 };

export interface ExportFile {
  app: 'habit-tracker';
  version: 1;
  exportedAt: string;
  settings: Settings;
  habits: Habit[];
  entries: Entry[];
}
