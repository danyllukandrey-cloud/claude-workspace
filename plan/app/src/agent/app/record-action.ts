// App: recordAction -- реальна реалізація DI-можливості "записати рядок у
// Лог дій", інжектована в use-case-и інших фіч (life-area-card/structure) і
// самого агента (Андрій: "Звіт активності -- це має бути Лог. В нього тупо
// пишемо кожну дію -- час, дія, все.").
//
// DI (ADR-0004, той самий підхід, що archive-card.ts's closeStructurePosition
// / update-card.ts's recordCardRenameEvent): кожен use-case, що хоче лишити
// слід у Лозі, приймає ОПЦІЙНИЙ параметр тієї самої форми (RecordAction, тип
// оголошується локально в кожному use-case-файлі -- сигнатура збігається з
// цим файлом, той самий стиль, що CloseStructurePositionForCard) -- сам
// use-case НІЧОГО не знає про action_log/agent, лише викликає передану
// функцію. Композиція (підстановка САМЕ цієї, реальної, реалізації) --
// відповідальність composition root (server/app.ts's AppDeps.recordAction,
// підключений один раз, server/index.ts).
//
// Відсутній recordAction (наявні виклики/тести, чи поки composition root не
// підключив) -- use-case просто не пише в Лог, не помилка (той самий
// fallback, що решта опційних колабораторів проєкту).

import { randomUUID } from 'node:crypto';
import { insertActionLogEntry } from '../infra/action-log-repo';
import type { Db } from '../infra/action-log-repo';

export type { Db };

export interface RecordActionInput {
  ownerUserId: string;
  /** Короткий людяний опис дії, напр. "Створено картку «Спорт»". */
  action: string;
}

/** Сигнатура, яку локально повторює кожен use-case, що приймає recordAction як DI-параметр. */
export type RecordAction = (db: Db, input: RecordActionInput) => Promise<void>;

export const recordAction: RecordAction = async (db, input) => {
  await insertActionLogEntry(db, { id: randomUUID(), ownerUserId: input.ownerUserId, action: input.action });
};
