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
//
// Review 2026-09-07 E (T52, "local-cache без прив'язки до власника й без
// evict при logout"): усі ключі нижче тепер несуть ownerUserId (той самий
// параметр, що postgres-repo.ts вимагає для non-disclosure, AC-04) --
// localStorage спільний для ВСІХ Google-акаунтів, що входили в цей браузер
// на цьому пристрої (ADR-0006 не має server-side сесій, лише JWT), тож без
// цього кеш ОДНОГО акаунта міг лишитись читомим після виходу й входу ІНШИМ.
// clearAllCachedData -- викликається на logout (main.tsx), щоб дані
// попереднього акаунта фізично не лишались у сховищі спільного пристрою.

import type { StoragePort } from '../../../shared/storage/port';
import type { Entry } from '../domain/entry';
import { computeProgress } from '../domain/progress';
import type { MetricBlockGoal, Progress } from '../domain/progress';

function entriesCacheKey(ownerUserId: string, cardId: string): string {
  return `life-area-card/${ownerUserId}/${cardId}/entries`;
}

export function readCachedEntries(storage: StoragePort, ownerUserId: string, cardId: string): Entry[] {
  return storage.read<Entry[]>(entriesCacheKey(ownerUserId, cardId)) ?? [];
}

export function cacheEntry(storage: StoragePort, ownerUserId: string, cardId: string, entry: Entry): void {
  const existing = readCachedEntries(storage, ownerUserId, cardId);
  storage.write(entriesCacheKey(ownerUserId, cardId), [...existing, entry]);
}

/**
 * Повне заміщення (як cacheMetricBlocks нижче), НЕ append (на відміну від
 * cacheEntry вище) -- T45 (review C13): GET .../entries при кожній успішній
 * синхронізації повертає актуальний повний список цієї картки, не приріст;
 * викликається з main.tsx після кожного успішного завантаження, щоб наступне
 * відкриття офлайн бачило ті самі дані, що бекенд показав востаннє.
 */
export function cacheEntries(storage: StoragePort, ownerUserId: string, cardId: string, entries: Entry[]): void {
  storage.write(entriesCacheKey(ownerUserId, cardId), entries);
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

function metricBlocksCacheKey(ownerUserId: string, cardId: string): string {
  return `life-area-card/${ownerUserId}/${cardId}/metric-blocks`;
}

export function readCachedMetricBlocks(storage: StoragePort, ownerUserId: string, cardId: string): CachedMetricBlock[] {
  return storage.read<CachedMetricBlock[]>(metricBlocksCacheKey(ownerUserId, cardId)) ?? [];
}

/** Повне заміщення -- GET .../metric-blocks завжди повертає актуальний повний список (не приріст). */
export function cacheMetricBlocks(storage: StoragePort, ownerUserId: string, cardId: string, blocks: CachedMetricBlock[]): void {
  storage.write(metricBlocksCacheKey(ownerUserId, cardId), blocks);
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
  ownerUserId: string,
  cardId: string,
  metricBlockId: string,
  goal: MetricBlockGoal,
): Progress {
  const blockEntries = readCachedEntries(storage, ownerUserId, cardId).filter((entry) => entry.metricBlockId === metricBlockId);
  return computeProgress(goal, blockEntries);
}

/**
 * Review 2026-09-07 E (T52): викликається на logout (main.tsx) -- StoragePort
 * навмисно не дає enumerate/scope-remove за ownerUserId (порт лишається
 * мінімальним key-value контрактом, ADR-0004), тож найпростіший спосіб
 * гарантувати "дані попереднього акаунта не лишаються на спільному пристрої"
 * -- повне очищення. Це ЄДИНЕ сховище цього застосунку в цьому origin (лише
 * JWT-сесія й цей кеш) -- повне очищення тут не зачіпає нічого стороннього.
 */
export function clearAllCachedData(storage: StoragePort): void {
  storage.clear();
}
