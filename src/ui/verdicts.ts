import type { Device, Verdict } from '../types';

export const VERDICTS: Verdict[] = ['absorb', 'rebuild', 'selfhost', 'haggle', 'rotate', 'cancel', 'keep'];

/** Verdicts that go into the build queue. */
export const BUILD_VERDICTS: Verdict[] = ['absorb', 'rebuild', 'selfhost'];
/** Verdicts shown under "Everything else", in order. */
export const OTHER_VERDICTS: Verdict[] = ['haggle', 'rotate', 'cancel', 'keep'];

export function isBuild(v: Verdict): boolean {
  return v === 'absorb' || v === 'rebuild' || v === 'selfhost';
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  absorb: 'ABSORB',
  rebuild: 'REBUILD',
  selfhost: 'SELF-HOST',
  haggle: 'HAGGLE',
  rotate: 'ROTATE',
  cancel: 'CANCEL',
  keep: 'KEEP',
};

export const VERDICT_DEFINITION: Record<Verdict, string> = {
  absorb: 'Claude already does this job. Cancel it and ask Claude instead.',
  rebuild: 'Claude Code builds you a free personal version in a weekend.',
  selfhost: 'An old device in your drawer runs the open-source equivalent.',
  haggle: 'Negotiate the price. You get a script, the leverage and the best time to ask.',
  rotate: 'Subscribe for a month, binge, cancel. Come back when there is something to watch.',
  cancel: 'Forgotten, duplicated or barely used. Steps included, and the traps to avoid.',
  keep: 'Worth paying for. Nothing cheaper does the same job well.',
};

/** Where the verdict leads the person, used for section subtitles. */
export const VERDICT_SECTION_NOTE: Record<Verdict, string> = {
  absorb: 'Claude does the job.',
  rebuild: 'Claude Code builds it.',
  selfhost: 'Runs on a device you own.',
  haggle: 'Ask for a better price.',
  rotate: 'Pay only the months you use it.',
  cancel: 'Stop paying.',
  keep: 'Leave it alone.',
};

export const DEVICES: { id: Device; label: string }[] = [
  { id: 'old-laptop', label: 'Old laptop' },
  { id: 'spare-pc', label: 'Spare PC' },
  { id: 'raspberry-pi', label: 'Raspberry Pi' },
  { id: 'nas', label: 'NAS' },
  { id: 'old-android', label: 'Old Android' },
  { id: 'old-iphone', label: 'Old iPhone' },
  { id: 'old-ipad', label: 'Old iPad' },
  { id: 'kindle', label: 'Kindle' },
];

export const DEVICE_LABEL: Record<Device, string> = Object.fromEntries(
  DEVICES.map((d) => [d.id, d.label]),
) as Record<Device, string>;

export function verdictVar(v: Verdict): string {
  return `var(--v-${v})`;
}
