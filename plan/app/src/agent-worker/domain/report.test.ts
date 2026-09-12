import { describe, it, expect } from 'vitest';
import { computeReportPeriod, activityReportIdempotencyKey } from './report';

// T11 (AC-11, domain invariant) -- worker формує звіт активності
// (activity-report, CONTEXT.md) за визначеним розкладом (тижневий/місячний/
// квартальний, D-70, sad.md Flow 14). Домен НІЧОГО не імпортує (plan/app/
// CLAUDE.md, "domain -> НІЧОГО") -- computeReportPeriod рахує лише межі
// періоду з дати відліку, use-case шар (T12+) підставить це в SQL-запит за
// активність і в activity_report.period_start/period_end.
//
// Межі рахуються в UTC-полях, зібраних із самого рядка YYYY-MM-DD (той самий
// підхід, що вже описаний у metric-block-handlers.ts для targetDate) --
// жодного toISOString(), щоб не зсунути календарну дату часовим поясом.

describe('computeReportPeriod -- weekly (AC-11)', () => {
  it('returns Monday..Sunday of the ISO week containing a mid-week reference date', () => {
    // 2026-09-10 -- четвер
    const period = computeReportPeriod('weekly', '2026-09-10');

    expect(period).toEqual({ periodStart: '2026-09-07', periodEnd: '2026-09-13' });
  });

  it('treats Sunday as the LAST day of its ISO week, not the first', () => {
    // 2026-09-13 -- неділя того самого тижня
    const period = computeReportPeriod('weekly', '2026-09-13');

    expect(period).toEqual({ periodStart: '2026-09-07', periodEnd: '2026-09-13' });
  });

  it('treats Monday as the FIRST day of its ISO week', () => {
    const period = computeReportPeriod('weekly', '2026-09-07');

    expect(period).toEqual({ periodStart: '2026-09-07', periodEnd: '2026-09-13' });
  });

  it('crosses a month boundary correctly', () => {
    // 2026-09-30 -- середа; тиждень охоплює вересень і жовтень
    const period = computeReportPeriod('weekly', '2026-09-30');

    expect(period).toEqual({ periodStart: '2026-09-28', periodEnd: '2026-10-04' });
  });
});

describe('computeReportPeriod -- monthly (AC-11)', () => {
  it('returns the 1st..last day of the calendar month', () => {
    const period = computeReportPeriod('monthly', '2026-09-10');

    expect(period).toEqual({ periodStart: '2026-09-01', periodEnd: '2026-09-30' });
  });

  it('handles February in a leap year correctly (29 days)', () => {
    const period = computeReportPeriod('monthly', '2028-02-15');

    expect(period).toEqual({ periodStart: '2028-02-01', periodEnd: '2028-02-29' });
  });

  it('handles February in a non-leap year correctly (28 days)', () => {
    const period = computeReportPeriod('monthly', '2026-02-15');

    expect(period).toEqual({ periodStart: '2026-02-01', periodEnd: '2026-02-28' });
  });
});

describe('computeReportPeriod -- quarterly (AC-11)', () => {
  it('returns Q1 (Jan-Mar) for a reference date in February', () => {
    const period = computeReportPeriod('quarterly', '2026-02-15');

    expect(period).toEqual({ periodStart: '2026-01-01', periodEnd: '2026-03-31' });
  });

  it('returns Q3 (Jul-Sep) for a reference date in August', () => {
    const period = computeReportPeriod('quarterly', '2026-08-01');

    expect(period).toEqual({ periodStart: '2026-07-01', periodEnd: '2026-09-30' });
  });

  it('returns Q4 (Oct-Dec) for a reference date on the last day of the year', () => {
    const period = computeReportPeriod('quarterly', '2026-12-31');

    expect(period).toEqual({ periodStart: '2026-10-01', periodEnd: '2026-12-31' });
  });
});

describe('activityReportIdempotencyKey -- (user, period_type, period_start), AC-11', () => {
  it('derives the same key from the same (user, period_type, period_start)', () => {
    const key1 = activityReportIdempotencyKey('user-1', 'weekly', '2026-09-07');
    const key2 = activityReportIdempotencyKey('user-1', 'weekly', '2026-09-07');

    expect(key1).toBe(key2);
  });

  it('derives a different key when periodType differs, everything else the same', () => {
    const weekly = activityReportIdempotencyKey('user-1', 'weekly', '2026-09-07');
    const monthly = activityReportIdempotencyKey('user-1', 'monthly', '2026-09-07');

    expect(weekly).not.toBe(monthly);
  });

  it('derives a different key when periodStart differs, everything else the same', () => {
    const week1 = activityReportIdempotencyKey('user-1', 'weekly', '2026-09-07');
    const week2 = activityReportIdempotencyKey('user-1', 'weekly', '2026-09-14');

    expect(week1).not.toBe(week2);
  });

  it('derives a different key when userId differs, everything else the same -- matches uq_activity_report_period (user_id, period_type, period_start)', () => {
    const forUser1 = activityReportIdempotencyKey('user-1', 'weekly', '2026-09-07');
    const forUser2 = activityReportIdempotencyKey('user-2', 'weekly', '2026-09-07');

    expect(forUser1).not.toBe(forUser2);
  });
});
