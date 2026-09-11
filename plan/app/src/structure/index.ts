// Публічний вхід Структури -- реєстрація в app-shell (T24, sad.md §5
// "index.ts -- реєстрація Структури в app-shell (singleton, не картка) +
// 3 навігаційні вкладки").
//
// Решта проєкту (тут -- src/app/App.tsx) імпортує Структуру ТІЛЬКИ звідси,
// ніколи напряму з ui/ (правило залежностей, plan/app/CLAUDE.md).

export { DeclarationScreen } from './ui/DeclarationScreen';
export type { DeclarationScreenProps, DeclarationScreenState } from './ui/DeclarationScreen';

export { LayoutBoard } from './ui/LayoutBoard';
export type { LayoutBoardProps, LayoutBoardState, LayoutBoardCard } from './ui/LayoutBoard';

export { AnalyticsScreen } from './ui/AnalyticsScreen';
export type { AnalyticsScreenProps, AnalyticsScreenState, AnalyticsScreenCard, AnalyticsTrend } from './ui/AnalyticsScreen';

// App-shell (App.tsx) типізує свій DI-проп onSaveDeclaration (PATCH /structure)
// цими самими доменними типами -- одна назва поняття, не власна копія enum'ів.
export type { LayoutMode, LogicVariant } from './domain/layout';

// main.tsx (loadAnalytics, ADR-0001 "ніколи не кешувати агрегат") -- та сама
// формула, що бекендний use-case get-analytics.ts, а не власна копія (D-19).
export { computeStructureAggregate } from './domain/aggregate';
