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

export function computeProgressFromCache(storage: StoragePort, cardId: string, goal: MetricBlockGoal): Progress {
  return computeProgress(goal, readCachedEntries(storage, cardId));
}
