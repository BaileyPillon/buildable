export type EventType = 'sleep' | 'feed' | 'diaper' | 'pump';
export type FeedMethod = 'breast' | 'bottle';
export type DiaperKind = 'pee' | 'poo' | 'both' | 'dry';
export type Side = 'left' | 'right';
export type BottleContent = 'breastmilk' | 'formula' | 'other';
export type Units = 'ml' | 'oz';
export type ThemeMode = 'auto' | 'day' | 'night';

/** Wake-window band, ages in whole weeks (toWeeks exclusive), windows in minutes. */
export interface WakeBand {
  fromWeeks: number;
  toWeeks: number;
  minMin: number;
  maxMin: number;
}

export interface Child {
  id: string;
  name: string;
  /** yyyy-mm-dd */
  birthdate: string;
  createdAt: number;
  /** Per-child editable wake windows; falls back to DEFAULT_BANDS when absent. */
  wakeBands?: WakeBand[];
}

export interface BabyEvent {
  id: string;
  childId: string;
  type: EventType;
  /** epoch ms */
  start: number;
  /** epoch ms; null while a timer is running (sleep, breast, bottle, pump) and for instant diapers it equals start */
  end: number | null;
  notes?: string;
  // feed
  method?: FeedMethod;
  leftMs?: number;
  rightMs?: number;
  /** breast timer bookkeeping while running */
  activeSide?: Side | null;
  sideSince?: number | null;
  content?: BottleContent;
  // bottle + pump amount in ml
  amountMl?: number;
  // diaper
  diaper?: DiaperKind;
}

export interface AppSettings {
  units: Units;
  themeMode: ThemeMode;
  selectedChildId: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = { units: 'ml', themeMode: 'auto', selectedChildId: null };

export interface BackupFile {
  app: 'nestlog';
  version: 1;
  exportedAt: string;
  settings: AppSettings;
  children: Child[];
  events: BabyEvent[];
}
