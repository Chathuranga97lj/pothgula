import { describe, expect, it } from 'vitest';
import { describeChange, logFilterSchema } from './log.js';

describe('describeChange', () => {
  it('lists only the fields an edit changed', () => {
    expect(
      describeChange(
        { condition: 'useable', notes: null, a: 1 },
        { condition: 'missing', notes: null, a: 1 },
      ),
    ).toEqual(['condition: useable → missing']);
  });

  it('lists every field of something new', () => {
    expect(describeChange(null, { title: 'කලියුගය', copies: 2 })).toEqual([
      'title: කලියුගය',
      'copies: 2',
    ]);
  });

  it('shortens long values and handles plain ones', () => {
    const [line] = describeChange(null, { notes: 'x'.repeat(200) });
    expect(line!.length).toBeLessThan(100);
    expect(describeChange(null, null)).toEqual([]);
    expect(describeChange('a', 'b')).toEqual(['a → b']);
  });

  it('spaces out nested values so they can wrap', () => {
    expect(describeChange(null, { filter: { from: '2026-01-01', action: 'borrow' } })).toEqual([
      'filter: {"from":"2026-01-01", "action":"borrow"}',
    ]);
  });
});

describe('logFilterSchema', () => {
  it('treats empty query values as unset and reads numbers', () => {
    expect(logFilterSchema.parse({ from: '', actorId: '12', role: '', action: 'borrow' })).toEqual({
      actorId: 12,
      action: 'borrow',
    });
  });

  it('refuses a backwards range and a record id without its kind', () => {
    expect(logFilterSchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
    expect(logFilterSchema.safeParse({ entityId: '3' }).success).toBe(false);
  });
});
