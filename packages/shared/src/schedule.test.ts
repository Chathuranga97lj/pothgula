import { describe, expect, it } from 'vitest';
import { noticeState } from './notices.js';
import {
  branchStatus,
  nextOpenDay,
  nowColomboTime,
  type Timetable,
  weekdayOf,
} from './schedule.js';

// 2026-11-09 is a Monday.
const MON = '2026-11-09';
const weekdays: Timetable = {
  configured: true,
  week: [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday <= 5
      ? { weekday, open: '09:00', close: '17:00' }
      : weekday === 6
        ? { weekday, open: '09:00', close: '12:30' }
        : { weekday, open: null, close: null },
  ),
  closures: [{ id: 1, date: '2026-11-11', reason: 'Poya day' }],
};

describe('opening hours (FR-SCH-01, FR-SCH-02, FR-SCH-04)', () => {
  it('knows the weekday of a date', () => {
    expect(weekdayOf(MON)).toBe(1);
    expect(weekdayOf('2026-11-15')).toBe(7);
  });

  it('says open until, opens at, or closed with the reason and the next opening', () => {
    expect(branchStatus(MON, '10:15', weekdays)).toEqual({ kind: 'open', until: '17:00' });
    expect(branchStatus(MON, '07:45', weekdays)).toEqual({ kind: 'opens_later', at: '09:00' });
    expect(branchStatus(MON, '17:00', weekdays)).toEqual({
      kind: 'closed',
      reason: null,
      next: { date: '2026-11-10', at: '09:00' },
    });
    expect(branchStatus('2026-11-11', '10:00', weekdays)).toEqual({
      kind: 'closed',
      reason: 'Poya day',
      next: { date: '2026-11-12', at: '09:00' },
    });
    expect(branchStatus('2026-11-15', '10:00', weekdays)).toMatchObject({
      kind: 'closed',
      next: { date: '2026-11-16' },
    });
  });

  it('says nothing it does not know', () => {
    expect(branchStatus(MON, '10:00', { configured: false, week: [], closures: [] })).toEqual({
      kind: 'unknown',
    });
  });

  it('moves a last day off a closed day, to the next opening', () => {
    expect(nextOpenDay(MON, weekdays)).toBe(MON);
    expect(nextOpenDay('2026-11-11', weekdays)).toBe('2026-11-12');
    expect(nextOpenDay('2026-11-15', weekdays)).toBe('2026-11-16');
    expect(nextOpenDay('2026-11-15', { configured: false, week: [], closures: [] })).toBe(
      '2026-11-15',
    );
  });

  it('tells the time in Colombo', () => {
    expect(nowColomboTime(new Date('2026-11-09T04:00:00Z'))).toBe('09:30');
  });
});

describe('when a notice is shown (FR-PUB-02, FR-PUB-03)', () => {
  const base = {
    kind: 'notice' as const,
    eventDate: null,
    showFrom: null,
    showUntil: null,
    withdrawnAt: null,
  };
  it('respects its dates, a withdrawal, and an event a week past', () => {
    expect(noticeState(base, MON)).toBe('shown');
    expect(noticeState({ ...base, showFrom: '2026-11-10' }, MON)).toBe('scheduled');
    expect(noticeState({ ...base, showUntil: '2026-11-08' }, MON)).toBe('ended');
    expect(noticeState({ ...base, withdrawnAt: '2026-11-01T00:00:00Z' }, MON)).toBe('withdrawn');
    const event = { ...base, kind: 'event' as const };
    expect(noticeState({ ...event, eventDate: '2026-11-02' }, MON)).toBe('shown');
    expect(noticeState({ ...event, eventDate: '2026-11-01' }, MON)).toBe('ended');
  });
});
