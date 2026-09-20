// T6 -- App: use-case "м'яко видалити пункт" (DELETE /api/v1/plan-items/{id},
// contracts/openapi.yaml deletePlanItem). Оркеструє репозиторій (T3,
// softDeletePlanItem) + опційний запис у Лог дій (AC-05) -- той самий шаблон,
// що ./create-plan-item.ts, ./update-plan-item.ts і
// cards/life-area-card/app/archive-metric-block.ts.
//
// DI (ADR-0004): `db` приходить параметром, use-case сам зʼєднання не створює
// і транзакцій не відкриває -- композицію робить викликач (ports).
//
// `ownerUserId` -- окремий позиційний параметр, а не поле input: його дає
// авторизований контекст запиту, а не тіло від клієнта (AC-07 вбудовано в
// форму сигнатури), точно як у сусідніх use-case цієї фічі.
//
// AC-04: "видалення" тут м'яке -- рядок лишається в базі зі status 'removed'
// і просто не потрапляє в listActivePlanItems. Фізичного DELETE в цій фічі
// немає ніде. Жест користувача ("очистив текст у редакторі й зберіг") живе в
// ui/ -- цей шар отримує вже готове рішення "прибрати пункт", інакше один і
// той самий виклик і оновлював би, і тихо прибирав пункт.
//
// Повертає void, а не пункт: контракт відповідає 204 без тіла, і віддавати
// назад щойно прибраний пункт означало б вигадати поле, якого в контракті нема.

import { softDeletePlanItem } from '../infra/postgres-repo';
import type { Db } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';
import type { RecordAction } from './create-plan-item';

export type { RecordAction };

export async function deletePlanItem(
  db: Db,
  ownerUserId: string,
  planItemId: string,
  recordAction?: RecordAction
): Promise<void> {
  // Мітка часу народжується тут (як createdAt у create-plan-item.ts) --
  // домен власного годинника не має.
  const removed = await softDeletePlanItem(db, ownerUserId, planItemId, new Date().toISOString());

  // Non-disclosure (AC-07): чужий, неіснуючий і вже прибраний пункт -- однакова
  // відповідь, той самий код, що в контракті (plan_item.not_found -> 404).
  if (!removed) {
    throw new AppError('plan_item.not_found', 'Пункт плану не знайдено', 404);
  }

  // AC-05: факт зміни -- людською мовою, у той самий Лог дій, що картки й
  // Структура. Лише ПІСЛЯ успішного прибирання: немає зміни -- немає й події.
  //
  // Без тексту прибраного пункту: v1 записує сам ФАКТ зміни, не попередній
  // текст (spec.md AC-05, §1 ¶4). Дістати текст тут коштувало б або другого
  // запиту (і гонки з паралельною правкою), або розширення контракту
  // softDeletePlanItem -- заради поля, яке спека для v1 свідомо не зберігає.
  if (recordAction) {
    await recordAction(db, {
      ownerUserId,
      action: 'Прибрано пункт плану',
    });
  }
}
