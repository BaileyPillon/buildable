export const PALETTE = [
  '#0f766e', // teal
  '#2563eb', // blue
  '#7c3aed', // violet
  '#c026d3', // fuchsia
  '#e11d48', // rose
  '#ea580c', // orange
  '#ca8a04', // amber
  '#16a34a', // green
];

export const COLOR_NAMES: Record<string, string> = {
  '#0f766e': 'Teal',
  '#2563eb': 'Blue',
  '#7c3aed': 'Violet',
  '#c026d3': 'Fuchsia',
  '#e11d48': 'Rose',
  '#ea580c': 'Orange',
  '#ca8a04': 'Amber',
  '#16a34a': 'Green',
};

export const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

export function newId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
