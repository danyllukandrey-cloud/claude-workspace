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

// D-121 (docs/app-shell.md): ChatScreen перейменовано на ChatPanel -- це вже
// не "напрямок"-екран, а постійна прикріплена панель (App.tsx монтує її поза
// перемикачем direction).
export { ChatPanel, CONFIRMED_HINT_TEXT } from './ui/ChatPanel';
export type { ChatPanelProps, SendMessageResult, OnboardingResult } from './ui/ChatPanel';

export { RuleSettingsScreen } from './ui/RuleSettingsScreen';
export type {
  RuleSettingsScreenProps,
  RuleSettingsScreenRule,
  RuleSettingsScreenTargetCard,
  RuleSettingsScreenSaveInput,
} from './ui/RuleSettingsScreen';

// "Лог дій" -- заміна ReportsScreen.tsx у навігації (той самий слот меню
// шестерні, D-123; Андрій: "Звіт активності -- дублює Аналітику. Це має
// бути Лог -- час, дія, все."). Backend-механізм періодичних звітів
// agent-worker (GET /api/v1/reports) лишається як є, просто більше не має
// UI-екрана -- ReportsScreen.tsx видалено разом із цим підключенням.
export { LogScreen } from './ui/LogScreen';
export type { LogScreenProps, LogEntryViewModel } from './ui/LogScreen';

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
