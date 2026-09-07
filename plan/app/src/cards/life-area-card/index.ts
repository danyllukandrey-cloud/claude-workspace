// Публічний вхід картки "Навчання/Здоров'я/..." -- generic life-area-card (D-23).
//
// Реєстрація в app-shell (T30, sad.md §5 "index.ts -- реєстрація картки в
// app-shell, одна картка-тип назавжди"): решта проєкту (тут -- src/app/main.tsx)
// імпортує картку ТІЛЬКИ звідси, ніколи напряму з ui/ чи domain/ (правило
// залежностей, plan/app/CLAUDE.md). DeckScreen (T25) -- стартовий екран
// колоди (SCR-01), єдине, що зовнішній світ бачить із цієї картки.

export { DeckScreen } from './ui/DeckScreen';
export type { DeckScreenProps } from './ui/DeckScreen';
export type { DeckGridItem } from './ui/DeckGrid';

export { CreateCardForm } from './ui/CreateCardForm';
export type { CreateCardFormProps, CreateCardFormInput } from './ui/CreateCardForm';

export { CardDetailScreen } from './ui/CardDetailScreen';
export type { CardDetailScreenProps } from './ui/CardDetailScreen';
export type { CardBackData, CardFaceData, EntryViewModel, MetricBlockViewModel } from './ui/types';
export type { MetricBlockFormValues } from './ui/MetricBlockForm';

export { ArchiveScreen } from './ui/ArchiveScreen';
export type { ArchiveScreenProps } from './ui/ArchiveScreen';

export { computeProgress, computeAggregateProgress } from './domain/progress';
export type { MetricBlockGoal, RawEntry, Progress } from './domain/progress';

// T45 (review 2026-09-07 B8/C13): main.tsx -- єдине місце, що підставляє
// реальний StoragePort (shared/storage/local.ts) -- читає/пише офлайн-кеш
// картки лише через ці функції, ніколи не сягаючи в infra/local-cache.ts напряму.
export {
  readCachedEntries,
  cacheEntries,
  cacheEntry,
  readCachedMetricBlocks,
  cacheMetricBlocks,
  computeProgressFromCache,
  clearAllCachedData,
} from './infra/local-cache';
export type { CachedMetricBlock } from './infra/local-cache';
