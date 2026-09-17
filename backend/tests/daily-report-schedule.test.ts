import { describe, it, expect } from '@jest/globals';
import { reportDateFor, SEND_HOUR_WAT } from '../src/lib/daily-report-mailer';

// The report goes out in the evening and covers the day it goes out. These
// pin the two facts a manager would notice if they slipped: nothing before
// 21:00 Lagos time, and the report dated today rather than yesterday.
const utc = (iso: string) => new Date(iso);

describe('daily report schedule', () => {
  it('defaults to 21:00 West Africa Time', () => {
    expect(SEND_HOUR_WAT).toBe(21);
  });

  it('holds the report until the hour has passed in Lagos, not UTC', () => {
    // 20:30 WAT is 19:30 UTC — still too early.
    expect(reportDateFor(utc('2026-09-17T19:30:00Z'))).toBeNull();
    // 21:00 WAT exactly.
    expect(reportDateFor(utc('2026-09-17T20:00:00Z'))?.toISOString().slice(0, 10)).toBe('2026-09-17');
  });

  it('covers the day it is sent, so the evening report is about today', () => {
    expect(reportDateFor(utc('2026-09-17T22:15:00Z'))?.toISOString().slice(0, 10)).toBe('2026-09-17');
  });

  it('does not slip into the next day at Lagos midnight', () => {
    // 23:30 UTC is 00:30 WAT on the 18th — before the hour again, so nothing.
    expect(reportDateFor(utc('2026-09-17T23:30:00Z'))).toBeNull();
  });
});
