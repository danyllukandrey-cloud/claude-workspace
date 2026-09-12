import { describe, it, expect } from 'vitest';
import { calendarDayKey, calendarDayBoundary, isDueForSync, selectDueForSync } from './sync-resource';
import type { SyncResourceForSchedule } from './sync-resource';

// T35 (AC-18) -- та сама логіка меж періоду, що T11 (activity_report), лише
// крок "календарний день", не тижневий/місячний/квартальний (tasks/
// t35-domain-resource-sync-schedule.md "What"). Домен НЕ звертається до БД
// (plan/app/CLAUDE.md -- "domain -> НІЧОГО") -- лише чисті функції над уже
// прочитаними полями ресурсу.

describe('calendarDayKey -- межа календарного дня (UTC)', () => {
  it('returns the same key for two timestamps within the same UTC calendar day', () => {
    const morning = new Date('2026-09-12T00:05:00.000Z');
    const evening = new Date('2026-09-12T23:55:00.000Z');

    expect(calendarDayKey(morning)).toBe(calendarDayKey(evening));
  });

  it('returns a different key just across the UTC midnight boundary', () => {
    const beforeMidnight = new Date('2026-09-12T23:59:59.999Z');
    const afterMidnight = new Date('2026-09-13T00:00:00.000Z');

    expect(calendarDayKey(beforeMidnight)).not.toBe(calendarDayKey(afterMidnight));
  });
});

describe('calendarDayBoundary -- межі одного календарного дня (той самий принцип, що T11 period boundary)', () => {
  it('computes the start (inclusive) and end (exclusive) of the UTC day containing the given instant', () => {
    const midDay = new Date('2026-09-12T14:30:00.000Z');

    const boundary = calendarDayBoundary(midDay);

    expect(boundary.start.toISOString()).toBe('2026-09-12T00:00:00.000Z');
    expect(boundary.end.toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });
});

describe('isDueForSync / selectDueForSync -- відбір ресурсів "потребують синхронізації зараз" (AC-18)', () => {
  const now = new Date('2026-09-12T09:00:00.000Z');

  it('is due when the resource has never been synced yet', () => {
    const resource: SyncResourceForSchedule = {
      id: 'res-1',
      status: 'active',
      lastSyncedAt: null,
    };

    expect(isDueForSync(resource, now)).toBe(true);
  });

  it('a resource already synced earlier today does NOT come up for sync again', () => {
    const resource: SyncResourceForSchedule = {
      id: 'res-2',
      status: 'active',
      lastSyncedAt: new Date('2026-09-12T00:10:00.000Z'),
    };

    expect(isDueForSync(resource, now)).toBe(false);
  });

  it('a resource last synced yesterday IS due again today', () => {
    const resource: SyncResourceForSchedule = {
      id: 'res-3',
      status: 'active',
      lastSyncedAt: new Date('2026-09-11T23:59:00.000Z'),
    };

    expect(isDueForSync(resource, now)).toBe(true);
  });

  it('accepts lastSyncedAt as an ISO string too (infra boundary may hand back a string, not a Date)', () => {
    const resource: SyncResourceForSchedule = {
      id: 'res-4',
      status: 'active',
      lastSyncedAt: '2026-09-12T00:10:00.000Z',
    };

    expect(isDueForSync(resource, now)).toBe(false);
  });

  it('a resource with status "error" still takes part in the next attempt -- it never gets stuck forever', () => {
    const erroredYesterday: SyncResourceForSchedule = {
      id: 'res-5',
      status: 'error',
      lastSyncedAt: new Date('2026-09-11T08:00:00.000Z'),
    };
    const erroredToday: SyncResourceForSchedule = {
      id: 'res-6',
      status: 'error',
      lastSyncedAt: new Date('2026-09-12T01:00:00.000Z'),
    };

    // Тільки денна межа вирішує -- не статус: помилка вчора означає нову
    // спробу сьогодні (AC-18b -- "не намагається мовчки повторювати
    // нескінченно" стосується частоти в межах ДНЯ, не забороняє щоденний
    // retry, який AC-18 і так планує).
    expect(isDueForSync(erroredYesterday, now)).toBe(true);
    // А спроба, що вже відбулась сьогодні (нехай і провалом), чекає завтра --
    // так само, як для 'active'.
    expect(isDueForSync(erroredToday, now)).toBe(false);
  });

  it('selectDueForSync filters a mixed batch down to only what needs syncing now', () => {
    const resources: SyncResourceForSchedule[] = [
      { id: 'synced-today', status: 'active', lastSyncedAt: new Date('2026-09-12T02:00:00.000Z') },
      { id: 'never-synced', status: 'active', lastSyncedAt: null },
      { id: 'synced-yesterday', status: 'active', lastSyncedAt: new Date('2026-09-11T02:00:00.000Z') },
      { id: 'errored-yesterday', status: 'error', lastSyncedAt: new Date('2026-09-11T20:00:00.000Z') },
    ];

    const due = selectDueForSync(resources, now);

    expect(due.map((r) => r.id).sort()).toEqual(['errored-yesterday', 'never-synced', 'synced-yesterday'].sort());
  });

  it('selectDueForSync returns an empty array when nothing is due', () => {
    const resources: SyncResourceForSchedule[] = [
      { id: 'synced-today', status: 'active', lastSyncedAt: new Date('2026-09-12T02:00:00.000Z') },
    ];

    expect(selectDueForSync(resources, now)).toEqual([]);
  });
});
