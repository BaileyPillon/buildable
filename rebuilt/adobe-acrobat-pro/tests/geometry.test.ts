import { describe, expect, it } from 'vitest';
import { makeViewTransform } from '../src/lib/geometry';

const box: [number, number, number, number] = [0, 0, 200, 300];

describe('view <-> user space', () => {
  it('rotation 0: y flips', () => {
    const t = makeViewTransform(box, 0);
    expect([t.width, t.height]).toEqual([200, 300]);
    expect(t.toUser(10, 20)).toEqual({ x: 10, y: 280 });
  });

  it('rotation 90: the displayed page is 300 wide and 200 tall', () => {
    const t = makeViewTransform(box, 90);
    expect([t.width, t.height]).toEqual([300, 200]);
    // top-left of the view is the bottom-left of the unrotated page
    expect(t.toUser(0, 0)).toEqual({ x: 0, y: 0 });
    // top-right of the view is the top-left of the unrotated page
    expect(t.toUser(300, 0)).toEqual({ x: 0, y: 300 });
    expect(t.textAngle).toBe(90);
  });

  it('rotation 180', () => {
    const t = makeViewTransform(box, 180);
    expect(t.toUser(0, 0)).toEqual({ x: 200, y: 0 });
    expect(t.textAngle).toBe(180);
  });

  it('rotation 270', () => {
    const t = makeViewTransform(box, 270);
    expect([t.width, t.height]).toEqual([300, 200]);
    expect(t.toUser(0, 200)).toEqual({ x: 0, y: 300 });
    expect(t.toUser(300, 0)).toEqual({ x: 200, y: 0 });
  });

  it('honours a crop box that does not start at the origin', () => {
    const t = makeViewTransform([10, 20, 110, 220], 0);
    expect(t.toUser(0, 0)).toEqual({ x: 10, y: 220 });
  });

  it('accepts negative / over-full rotations', () => {
    expect(makeViewTransform(box, -90).rotation).toBe(270);
    expect(makeViewTransform(box, 450).rotation).toBe(90);
  });
});
