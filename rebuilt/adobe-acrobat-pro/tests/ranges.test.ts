import { describe, expect, it } from 'vitest';
import { chunkEvery, formatPageList, parsePageList, parseRangeGroups, RangeSyntaxError } from '../src/lib/ranges';

describe('page ranges', () => {
  it('parses singles, ranges and open ends (1-based in, 0-based out)', () => {
    expect(parsePageList('1-3, 5, 8-', 9)).toEqual([0, 1, 2, 4, 7, 8]);
    expect(parsePageList('-2', 5)).toEqual([0, 1]);
    expect(parsePageList('last', 5)).toEqual([4]);
    expect(parsePageList('all', 3)).toEqual([0, 1, 2]);
  });

  it('keeps the order typed', () => {
    expect(parsePageList('3,1', 3)).toEqual([2, 0]);
  });

  it('gives each token its own group for splitting', () => {
    expect(parseRangeGroups('1-2 3 4-', 5)).toEqual([[0, 1], [2], [3, 4]]);
  });

  it('rejects bad input with a useful message', () => {
    expect(() => parsePageList('', 5)).toThrow(RangeSyntaxError);
    expect(() => parsePageList('0', 5)).toThrow(/start at 1/);
    expect(() => parsePageList('6', 5)).toThrow(/outside/);
    expect(() => parsePageList('4-2', 5)).toThrow(/backwards/);
    expect(() => parsePageList('abc', 5)).toThrow(/not a page/);
  });

  it('formats a selection compactly', () => {
    expect(formatPageList([0, 1, 2, 4, 7, 8])).toBe('1-3, 5, 8-9');
    expect(formatPageList([])).toBe('');
  });

  it('chunks every N pages', () => {
    expect(chunkEvery(7, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(() => chunkEvery(7, 0)).toThrow();
  });
});
