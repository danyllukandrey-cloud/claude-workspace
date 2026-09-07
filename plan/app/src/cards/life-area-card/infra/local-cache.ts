// Кеш сирих подій картки (T11) — офлайн-доступність читання й запису
// (spec.md §6 NFR, ADR-0001 "перераховуємо з сирих подій, ніколи не кешуємо
// готове число").
//
// Кешуємо СИРІ події (Entry[] з domain/entry.ts), НЕ готовий прогрес --
// той самий computeProgress (T6) рахує прогрес над кешем локально, точно
// так само, як над відповіддю бекенда, коли він з'явиться.
//
// Правило залежностей (ADR-0004): цей файл приймає StoragePort ЗЗОВНІ
// (dependency injection, параметр кожної функції) -- сам ніколи не створює
// localStorage й не імпортує shared/storage/local.ts. Підстановку реальної
// реалізації робить викликач (app/main.tsx).

import type { StoragePort } from '../../../shared/storage/port';
import type { Entry } from '../domain/entry';
import { computeProgress } from '../domain/progress';
import type { MetricBlockGoal, Progress } from '../domain/progress';

function entriesCacheKey(cardId: string): string {
  return `life-area-card/${cardId}/entries`;
}

export function readCachedEntries(storage: StoragePort, cardId: string): Entry[] {
  return storage.read<Entry[]>(entriesCacheKey(cardId)) ?? [];
}

export function cacheEntry(storage: StoragePort, cardId: string, entry: Entry): void {
  const existing = readCachedEntries(storage, cardId);
  storage.write(entriesCacheKey(cardId), [...existing, entry]);
}

/**
 * Повне заміщення (як cacheMetricBlocks нижче), НЕ append (на відміну від
 * cacheEntry вище) -- T45 (review C13): GET .../entries при кожній успішній
 * синхронізації повертає актуальний повний список цієї картки, не приріст;
 * викликається з main.tsx після кожного успішного завантаження, щоб наступне
 * відкриття офлайн бачило ті самі дані, що бекенд показав востаннє.
 */
export function cacheEntries(storage: StoragePort, cardId: string, entries: Entry[]): void {
  storage.write(entriesCacheKey(cardId), entries);
}

// --- Метадані блоків-метрик (D-106, закриває ISS-39; доповнює T11) ---------
//
// QG-1 (sad.md §10) вимагає: відкриття картки БЕЗ мережі читає картку й
// історію зі 100% з кешу. GET /cards/{cardId}/metric-blocks (D-106) віддає
// метадані блоків (label/unit/targetCount/isOngoing/targetDate), яких PWA
// потребує ДО того, як рахувати прогрес із сирих подій (Critical flow 4/6) --
// але сам виклик мережевий, тож блокуюча залежність від нього ламала б QG-1
// для картки, відкритої вдруге офлайн. Рішення: кешуємо метадані ПОВНИМ
// заміщенням (не append, як cacheEntry, -- GET завжди повертає актуальний
// повний список, не приріст) при кожній успішній синхронізації (перше
// відкриття онлайн, чи після create/transfer блоку), Critical flow 4 читає
// звідси в першу чергу й лише за відсутності кешованих метаданих (і за
// наявності мережі) звертається до бекенда.

export interface CachedMetricBlock {
  id: string;
  label: string;
  unit: string;
  frequency: string | null;
  targetCount: number | null;
  isOngoing: boolean;
  targetDate: string | null;
}

function metricBlocksCacheKey(cardId: string): string {
  return `life-area-card/${cardId}/metric-blocks`;
}

export function readCachedMetricBlocks(storage: StoragePort, cardId: string): CachedMetricBlock[] {
  return storage.read<CachedMetricBlock[]>(metricBlocksCacheKey(cardId)) ?? [];
}

/** Повне заміщення -- GET .../metric-blocks завжди повертає актуальний повний список (не приріст). */
export function cacheMetricBlocks(storage: StoragePort, cardId: string, blocks: CachedMetricBlock[]): void {
  storage.write(metricBlocksCacheKey(cardId), blocks);
}

/**
 * Review 2026-09-07 B8 (D-38, "units don't sum across blocks"): фільтруємо
 * ЛИШЕ записи цього блоку -- до цього фіксу тут читались УСІ записи картки,
 * тож дві різні метрики (наприклад "км" і "хвилини") мовчки підсумовувались
 * би в один прогрес, щойно картка мала більше одного блоку. Ізольований
 * юніт-тест цього не ловив (кожен приклад кешував записи лише одного блоку).
 */
export function computeProgressFromCache(
  storage: StoragePort,
  cardId: string,
  metricBlockId: string,
  goal: MetricBlockGoal,
): Progress {
  const blockEntries = readCachedEntries(storage, cardId).filter((entry) => entry.metricBlockId === metricBlockId);
  return computeProgress(goal, blockEntries);
}
