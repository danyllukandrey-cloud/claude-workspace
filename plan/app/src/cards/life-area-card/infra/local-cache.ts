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

export function computeProgressFromCache(storage: StoragePort, cardId: string, goal: MetricBlockGoal): Progress {
  return computeProgress(goal, readCachedEntries(storage, cardId));
}
