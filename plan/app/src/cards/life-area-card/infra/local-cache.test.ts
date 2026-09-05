import { describe, it, expect } from 'vitest';
import type { StoragePort } from '../../../shared/storage/port';
import { createEntry } from '../domain/entry';
import { computeProgress } from '../domain/progress';
import type { RawEntry, MetricBlockGoal } from '../domain/progress';
import { readCachedEntries, cacheEntry, computeProgressFromCache } from './local-cache';

// Проста фейкова реалізація StoragePort -- Map у пам'яті, без localStorage і
// без мережі. Нормальна практика для коду за портами (T11 task context):
// domain/infra тестуються проти інтерфейсу, не проти справжнього сховища.
function createFakeStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
    read<T>(key: string): T | null {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    write<T>(key: string, value: T): void {
      store.set(key, value);
    },
    remove(key: string): void {
      store.delete(key);
    },
  };
}

describe('readCachedEntries', () => {
  // NFR spec.md §6: «Офлайн-доступність (читання) — 100% — картка й історія
  // відкриваються з кешу без мережі». Фейковий StoragePort не робить жодного
  // мережевого виклику за визначенням -- доводимо, що раніше записані події
  // читаються назад рівно з нього.
  it('reads previously cached entries back without any network call', () => {
    const storage = createFakeStorage();
    const entry = createEntry({ id: 'entry-1', metricBlockId: 'block-1', amount: 3 });
    cacheEntry(storage, 'card-1', entry);

    expect(readCachedEntries(storage, 'card-1')).toEqual([entry]);
  });
});

describe('cacheEntry', () => {
  // NFR spec.md §6: «Офлайн-доступність (запис) — Запис приймається офлайн,
  // але лишається "в очікуванні" до підтвердження агентом (AC-11), не
  // рахується одразу». Записаний через кеш entry (entry.ts createEntry з
  // needsReview:true) має лишитись зі status:'pending' після зчитування назад.
  it('accepts an offline write and keeps it pending until confirmed', () => {
    const storage = createFakeStorage();
    const entry = createEntry({ id: 'entry-2', metricBlockId: 'block-1', amount: 5, needsReview: true });
    cacheEntry(storage, 'card-1', entry);

    const [cached] = readCachedEntries(storage, 'card-1');
    expect(cached.status).toBe('pending');
  });
});

describe('computeProgressFromCache', () => {
  // ADR-0001 + T11 "What": PWA рахує прогрес ТИМ САМИМ computeProgress (T6)
  // над кешем локально, не другою реалізацією. Закешуй кілька подій, прочитай
  // їх назад, прожени через computeProgress -- результат має точно збігатись
  // із прямим викликом computeProgress над тим самим масивом без кешу.
  it('matches computeProgress called directly on the same raw entries, without going through the cache', () => {
    const storage = createFakeStorage();
    const goal: MetricBlockGoal = { targetCount: 10, isOngoing: false };
    const rawEntries: RawEntry[] = [
      { amount: 2, status: 'confirmed' },
      { amount: 3, status: 'confirmed' },
      { amount: 1, status: 'pending' },
    ];
    rawEntries.forEach((raw, index) => {
      cacheEntry(
        storage,
        'card-1',
        createEntry({
          id: `entry-${index}`,
          metricBlockId: 'block-1',
          amount: raw.amount,
          needsReview: raw.status === 'pending',
        }),
      );
    });

    const directResult = computeProgress(goal, rawEntries);
    const cachedResult = computeProgressFromCache(storage, 'card-1', goal);

    expect(cachedResult).toEqual(directResult);
  });
});
