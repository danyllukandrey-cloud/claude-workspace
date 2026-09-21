// Публічний вхід фічі «ПЛАН» (life-plan-levels) -- реєстрація в app-shell
// (T11, tasks/T11-app-navigation-wiring.md).
//
// Решта проєкту (тут -- src/app/App.tsx і src/app/main.tsx) імпортує ПЛАН
// ТІЛЬКИ звідси, ніколи напряму з ui/ чи domain/ (правило залежностей,
// plan/app/CLAUDE.md) -- той самий барʼєр, що structure/index.ts.

export { PlanScreen, PLAN_HORIZON_LABELS } from './ui/PlanScreen';
export type { PlanScreenProps, PlanScreenItem } from './ui/PlanScreen';

export { PlanItemEditor } from './ui/PlanItemEditor';
export type { PlanItemEditorProps, PlanItemEditorTarget } from './ui/PlanItemEditor';

// App.tsx і main.tsx типізують свої DI-пропи цим самим доменним типом -- одна
// назва поняття на весь застосунок, не власна копія трьох літералів
// (той самий підхід, що structure's LayoutMode).
export { PLAN_HORIZONS } from './domain/plan-item';
export type { PlanHorizon } from './domain/plan-item';
