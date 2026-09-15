// Публічний вхід Структури -- реєстрація в app-shell (T24, sad.md §5
// "index.ts -- реєстрація Структури в app-shell (singleton, не картка) +
// 3 навігаційні вкладки").
//
// Решта проєкту (тут -- src/app/App.tsx) імпортує Структуру ТІЛЬКИ звідси,
// ніколи напряму з ui/ (правило залежностей, plan/app/CLAUDE.md).

export { DeclarationScreen } from './ui/DeclarationScreen';
export type { DeclarationScreenProps, DeclarationScreenState } from './ui/DeclarationScreen';

export { LayoutBoard } from './ui/LayoutBoard';
export type {
  LayoutBoardProps,
  LayoutBoardState,
  LayoutBoardCard,
  LayoutBoardCloseCardOptions,
} from './ui/LayoutBoard';

// Review 2026-09-11 (MUST-FIX 4): SCR-04 був написаний і протестований, але не
// віддавався звідси й не підключався ніде -- AC-12 недосяжний користувачу. Типи
// експортуються разом із компонентом: composition root (app/main.tsx) типізує
// ними свої fetch-реалізації, LayoutBoard -- свої пропи.
export { CloseCardDialog } from './ui/CloseCardDialog';
export type {
  CloseCardDialogProps,
  CloseCardDialogMetricBlock,
  CloseCardDialogTargetCard,
  CloseCardMetricTransferInput,
} from './ui/CloseCardDialog';

export { AnalyticsScreen } from './ui/AnalyticsScreen';
export type { AnalyticsScreenProps, AnalyticsScreenState, AnalyticsScreenCard, AnalyticsTrend } from './ui/AnalyticsScreen';

// App-shell (App.tsx) типізує свій DI-проп onSaveDeclaration (PATCH /structure)
// цим самим доменним типом -- одна назва поняття, не власна копія enum'у.
// Вимоги 14/15: LogicVariant прибраний, layoutMode -- ОДНЕ плоске поле.
export type { LayoutMode } from './domain/layout';

// main.tsx (loadAnalytics, ADR-0001 "ніколи не кешувати агрегат") -- та сама
// формула, що бекендний use-case get-analytics.ts, а не власна копія (D-19).
//
// Review 2026-09-11 (MUST-FIX 5): раніше звідси виходила лише
// computeStructureAggregate, тож main.tsx не мав чим порахувати ранг-розрив
// (AC-06), прапорець "заявлено -- не ведеться" (AC-06b) і напрямок тренду
// (AC-07) -- і ставив їх хардкодом у null/false. sad.md §6 Critical flow 9
// прямо каже, що ці три числа рахує САМ PWA-клієнт (а не готовий ендпоінт
// аналітики, якого в контракті немає), тому доменні функції мусять бути
// досяжні через публічний вхід -- формула лишається ОДНА (D-19), просто
// викликається з двох боків.
export {
  computeStructureAggregate,
  computeLogicLayoutGaps,
  logicLayoutScale,
  computeCardGapTrend,
  flagUnmaintainedCards,
} from './domain/aggregate';
export type { GapTrend, LogicLayoutScale } from './domain/aggregate';
