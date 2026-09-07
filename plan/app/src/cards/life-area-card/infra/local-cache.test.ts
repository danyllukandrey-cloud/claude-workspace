import { describe, it, expect } from 'vitest';
import type { StoragePort } from '../../../shared/storage/port';
import { createEntry } from '../domain/entry';
import { computeProgress } from '../domain/progress';
import type { RawEntry, MetricBlockGoal } from '../domain/progress';
import {
  readCachedEntries,
  cacheEntry,
  cacheEntries,
  computeProgressFromCache,
  readCachedMetricBlocks,
  cacheMetricBlocks,
  clearAllCachedData,
} from './local-cache';
import type { CachedMetricBlock } from './local-cache';

const OWNER = 'user-1';
const OTHER_OWNER = 'user-2';

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
    clear(): void {
      store.clear();
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
    cacheEntry(storage, OWNER, 'card-1', entry);

    expect(readCachedEntries(storage, OWNER, 'card-1')).toEqual([entry]);
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
    cacheEntry(storage, OWNER, 'card-1', entry);

    const [cached] = readCachedEntries(storage, OWNER, 'card-1');
    expect(cached.status).toBe('pending');
  });
});

describe('readCachedMetricBlocks / cacheMetricBlocks (D-106, закриває ISS-39)', () => {
  const BLOCK: CachedMetricBlock = {
    id: 'block-1',
    label: 'Пробіжки',
    unit: 'км',
    frequency: null,
    targetCount: 10,
    isOngoing: false,
    targetDate: null,
  };

  // QG-1 (sad.md §10): відкриття картки БЕЗ мережі читає метадані блоків
  // зі 100% з кешу -- фейковий StoragePort не робить жодного мережевого
  // виклику за визначенням, доводимо, що раніше синхронізовані метадані
  // читаються назад рівно з нього.
  it('reads previously synced metric-block metadata back without any network call', () => {
    const storage = createFakeStorage();
    cacheMetricBlocks(storage, OWNER, 'card-1', [BLOCK]);

    expect(readCachedMetricBlocks(storage, OWNER, 'card-1')).toEqual([BLOCK]);
  });

  // Немає кешованих метаданих (картка ще ніколи не синхронізувалась) --
  // порожній масив, не помилка й не null -- той самий контракт, що readCachedEntries.
  it('returns an empty array when nothing has been synced yet', () => {
    const storage = createFakeStorage();

    expect(readCachedMetricBlocks(storage, OWNER, 'card-1')).toEqual([]);
  });

  // Повне заміщення, НЕ append (на відміну від cacheEntry) -- GET .../metric-blocks
  // завжди повертає актуальний повний список, не приріст.
  it('replaces the cached list wholesale on each sync, unlike the append-only entries cache', () => {
    const storage = createFakeStorage();
    cacheMetricBlocks(storage, OWNER, 'card-1', [BLOCK]);

    const renamed = { ...BLOCK, label: 'Біг' };
    cacheMetricBlocks(storage, OWNER, 'card-1', [renamed]);

    expect(readCachedMetricBlocks(storage, OWNER, 'card-1')).toEqual([renamed]);
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
        OWNER,
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
    const cachedResult = computeProgressFromCache(storage, OWNER, 'card-1', 'block-1', goal);

    expect(cachedResult).toEqual(directResult);
  });

  // Review 2026-09-07 B8 (D-38): регресійний тест на саму знахідку -- картка
  // з ДВОМА блоками-метриками, кожен зі своєю одиницею. До фіксу
  // computeProgressFromCache читав УСІ записи картки без фільтра -- ця
  // перевірка впала б, показуючи share, порахований з сумішки обох блоків.
  it('does not sum entries from a different metric-block on the same card (D-38, units differ)', () => {
    const storage = createFakeStorage();
    cacheEntry(storage, OWNER, 'card-1', createEntry({ id: 'entry-km', metricBlockId: 'block-km', amount: 3 }));
    cacheEntry(storage, OWNER, 'card-1', createEntry({ id: 'entry-min', metricBlockId: 'block-min', amount: 40 }));

    const goalKm: MetricBlockGoal = { targetCount: 10, isOngoing: false };
    const resultKm = computeProgressFromCache(storage, OWNER, 'card-1', 'block-km', goalKm);

    // Якби фільтра не було, accumulated тут було б 3+40=43, а не 3.
    expect(resultKm).toMatchObject({ kind: 'bounded', share: 3 / 10, overGoal: 0 });
  });
});

describe('cacheEntries (T45, review C13 -- повне заміщення на кожній синхронізації)', () => {
  it('replaces the cached list wholesale, unlike the append-only cacheEntry', () => {
    const storage = createFakeStorage();
    cacheEntry(storage, OWNER, 'card-1', createEntry({ id: 'stale-entry', metricBlockId: 'block-1', amount: 1 }));

    const freshFromServer = [createEntry({ id: 'entry-1', metricBlockId: 'block-1', amount: 5 })];
    cacheEntries(storage, OWNER, 'card-1', freshFromServer);

    expect(readCachedEntries(storage, OWNER, 'card-1')).toEqual(freshFromServer);
  });
});

// Review 2026-09-07 E (T52, "local-cache без прив'язки до власника й без
// evict при logout"): localStorage спільний для ВСІХ Google-акаунтів, що
// коли-небудь входили на цьому пристрої (ADR-0006 не має server-side сесій).
// Без ownerUserId у ключі два різні акаунти з коли-небудь однаковим cardId
// (теоретично неможливо для UUID, але захист належить на рівні дизайну, не
// випадковості формату id) чи просто послідовний вхід різних людей на
// спільному комп'ютері побачили б чужий кеш під тим самим ключем.

describe('T52: ключі кешу namespaced за ownerUserId', () => {
  it('той самий cardId під різними ownerUserId кешується окремо (не перезаписує один одного)', () => {
    const storage = createFakeStorage();
    const entryOwner1 = createEntry({ id: 'entry-owner1', metricBlockId: 'block-1', amount: 5 });
    const entryOwner2 = createEntry({ id: 'entry-owner2', metricBlockId: 'block-1', amount: 9 });

    cacheEntry(storage, OWNER, 'card-1', entryOwner1);
    cacheEntry(storage, OTHER_OWNER, 'card-1', entryOwner2);

    expect(readCachedEntries(storage, OWNER, 'card-1')).toEqual([entryOwner1]);
    expect(readCachedEntries(storage, OTHER_OWNER, 'card-1')).toEqual([entryOwner2]);
  });

  it('те саме для метаданих блоків-метрик', () => {
    const storage = createFakeStorage();
    const blockOwner1: CachedMetricBlock = {
      id: 'block-1',
      label: 'Пробіжки',
      unit: 'км',
      frequency: null,
      targetCount: 10,
      isOngoing: false,
      targetDate: null,
    };
    const blockOwner2: CachedMetricBlock = { ...blockOwner1, label: 'Плавання', unit: 'хв' };

    cacheMetricBlocks(storage, OWNER, 'card-1', [blockOwner1]);
    cacheMetricBlocks(storage, OTHER_OWNER, 'card-1', [blockOwner2]);

    expect(readCachedMetricBlocks(storage, OWNER, 'card-1')).toEqual([blockOwner1]);
    expect(readCachedMetricBlocks(storage, OTHER_OWNER, 'card-1')).toEqual([blockOwner2]);
  });
});

describe('T52: clearAllCachedData (виклик на logout)', () => {
  it('очищає кеш усіх акаунтів, не лише поточного -- спільний пристрій не лишає чужих даних читомими', () => {
    const storage = createFakeStorage();
    cacheEntry(storage, OWNER, 'card-1', createEntry({ id: 'entry-1', metricBlockId: 'block-1', amount: 5 }));
    cacheEntry(storage, OTHER_OWNER, 'card-2', createEntry({ id: 'entry-2', metricBlockId: 'block-2', amount: 9 }));

    clearAllCachedData(storage);

    expect(readCachedEntries(storage, OWNER, 'card-1')).toEqual([]);
    expect(readCachedEntries(storage, OTHER_OWNER, 'card-2')).toEqual([]);
  });
});
