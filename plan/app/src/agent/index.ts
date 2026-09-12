// Публічний вхід агента -- реєстрація в app-shell (T29, tasks.json files_hint
// "plan/app/src/agent/index.ts"). Той самий підхід, що ../structure/index.ts.
//
// Решта проєкту (тут -- src/app/App.tsx) імпортує агента ТІЛЬКИ звідси,
// ніколи напряму з ui/ (правило залежностей, plan/app/CLAUDE.md: "картка ->
// картка ЗАБОРОНЕНО. Тільки через shared/ або app/" -- той самий принцип
// застосований тут до фічі "агент").
//
// Review 2026-09-11 (структура, MUST-FIX 4/5): попередній аналогічний файл
// (../structure/index.ts) отримав два фікси саме за те, що написаний і
// протестований компонент НЕ був звідси доступний -- composition root не мав
// звідки його підключити, і AC лишався недосяжним користувачу. Урок
// застосований тут одразу, не заднім числом: усі 4 екрани SCR-01..SCR-04 і
// їхні пропи-типи експортуються в ЦЬОМУ ж коміті, що й підключення в
// src/app/main.tsx/App.tsx нижче -- src/agent/index.test.tsx пінить саме
// досяжність (реальний рендер через ці двері), не лише факт експорту.

export { ChatScreen, CONFIRMED_HINT_TEXT } from './ui/ChatScreen';
export type { ChatScreenProps, SendMessageResult, OnboardingResult } from './ui/ChatScreen';

export { RuleSettingsScreen } from './ui/RuleSettingsScreen';
export type {
  RuleSettingsScreenProps,
  RuleSettingsScreenRule,
  RuleSettingsScreenTargetCard,
  RuleSettingsScreenSaveInput,
} from './ui/RuleSettingsScreen';

export { ReportsScreen } from './ui/ReportsScreen';
export type { ReportsScreenProps, ReportViewModel, ReportStatus } from './ui/ReportsScreen';

export { AccountScreen } from './ui/AccountScreen';
export type { AccountScreenProps, AccountScreenResource } from './ui/AccountScreen';

// ui/chat/types.ts -- форма ChatMessage/ChatProposal, потрібна composition
// root'у (main.tsx), щоб типізувати свої fetch-реалізації loadHistory/
// loadActiveProposal без власної копії цих полів (D-19).
export type { ChatMessage, ChatProposal } from './ui/chat/types';
export type { ComposerSendInput } from './ui/chat/Composer';

// domain/rules.ts -- ImperativeRuleCategory використовує RuleSettingsScreen
// (пропи RuleSettingsScreenRule/RuleCreateInput), composition root типізує
// ним свої DTO 1:1 із контрактом, не власною копією enum'у (D-19, той самий
// підхід, що ../structure/index.ts's LayoutMode/LogicVariant).
export type { ImperativeRuleCategory } from './domain/rules';
