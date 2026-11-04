import type { BabyEvent, Units } from './types';
import { formatDuration } from './time';
import { formatAmount } from './share';
import { breastMs } from './summary';

export interface Described {
  title: string;
  detail: string;
}

export function describeEvent(e: BabyEvent, units: Units, now: number): Described {
  const dur = e.end == null ? now - e.start : e.end - e.start;
  switch (e.type) {
    case 'sleep':
      return { title: 'Sleep', detail: formatDuration(dur) + (e.end == null ? ' so far' : '') };
    case 'feed': {
      if (e.method === 'bottle') {
        const bits = [e.content === 'breastmilk' ? 'breast milk' : e.content, formatAmount(e.amountMl, units), dur > 0 ? formatDuration(dur) : ''].filter(Boolean);
        return { title: 'Bottle', detail: bits.join(' · ') };
      }
      const l = e.leftMs ? `L ${formatDuration(e.leftMs)}` : '';
      const r = e.rightMs ? `R ${formatDuration(e.rightMs)}` : '';
      const both = [l, r].filter(Boolean).join(' · ');
      return { title: 'Breast', detail: both || formatDuration(breastMs(e, now)) };
    }
    case 'diaper': {
      const k = e.diaper ?? 'pee';
      return { title: 'Diaper', detail: k === 'pee' ? 'Wet' : k === 'poo' ? 'Dirty' : k === 'both' ? 'Wet and dirty' : 'Dry' };
    }
    case 'pump':
      return { title: 'Pumping', detail: [formatAmount(e.amountMl, units), dur > 0 ? formatDuration(dur) : ''].filter(Boolean).join(' · ') };
  }
}
