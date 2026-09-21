// T5 -- App: use-case "оновити текст і/чи чекбокс" (PATCH /api/v1/plan-items/{id},
// contracts/openapi.yaml updatePlanItem). Оркеструє домен (T2, правило
// непорожнього тексту) + репозиторій (T3, часткове оновлення) + опційний запис
// у Лог дій (AC-05) -- той самий шаблон, що ./create-plan-item.ts і
// cards/life-area-card/app/update-card.ts.
//
// DI (ADR-0004): `db` приходить параметром, use-case сам зʼєднання не створює
// і транзакцій не відкриває -- композицію робить викликач (ports).
//
// `ownerUserId` -- окремий позиційний параметр, а не поле input: його дає
// авторизований контекст запиту, а не тіло від клієнта (AC-07 вбудовано в
// форму сигнатури), точно як у create-plan-item.ts і в infra/postgres-repo.ts.
//
// Дві незалежні правки в одному use-case (AC-03/AC-03b чекбокс і непорожнє
// редагування тексту), бо на рівні бази це один UPDATE -- але в Лозі дій вони
// лишають ДВА різні сліди, якщо змінились обидві: це дві різні зміни очима
// користувача (той самий підхід, що update-card.ts із 'filled' + перейменуванням).
//
// Порожній `planText` тут -- ПОМИЛКА, а не видалення: прибирання пункту має
// власний use-case (T6, DELETE у контракті). AC-04 говорить про жест у
// РЕДАКТОРІ ("очистив текст і зберіг") -- перекласти цей жест на виклик DELETE
// має ui/, а не цей шар; інакше один і той самий виклик і оновлював би, і
// тихо прибирав пункт.

import { assertPlanTextPresent } from '../domain/plan-item';
import type { PlanItem } from '../domain/plan-item';
import { updatePlanItem as updatePlanItemRow } from '../infra/postgres-repo';
import type { Db } from '../infra/postgres-repo';
import { AppError } from '../../shared/errors';
import type { RecordAction } from './create-plan-item';

export interface UpdatePlanItemInput {
  /** Новий текст пункту, якщо змінюється в цьому виклику. Має бути непорожнім. */
  planText?: string;
  /** Чекбокс "виконано" -- реверсивний тумблер (AC-03b): будь-яке булеве значення. */
  done?: boolean;
}

export type { RecordAction };

export async function updatePlanItem(
  db: Db,
  ownerUserId: string,
  planItemId: string,
  input: UpdatePlanItemInput,
  recordAction?: RecordAction
): Promise<PlanItem> {
  const textChanges = input.planText !== undefined;
  const doneChanges = input.done !== undefined;

  // Порожній патч -- не звертаємось до бази взагалі: репозиторій написав би
  // саму лише updated_at, і пункт виглядав би зміненим, хоча нічого не змінилось.
  if (!textChanges && !doneChanges) {
    throw new AppError('plan_item.nothing_to_update', 'Немає що оновлювати в пункті плану', 400);
  }

  // Та сама доменна перевірка, що при створенні -- і так само ДО будь-якого
  // db.query, тож невдала правка не лишає в базі жодного сліду.
  if (textChanges) {
    assertPlanTextPresent(input.planText);
  }

  const patch: { planText?: string; done?: boolean } = {};
  if (textChanges) patch.planText = (input.planText as string).trim();
  if (doneChanges) patch.done = input.done;

  const updated = await updatePlanItemRow(db, ownerUserId, planItemId, patch, new Date().toISOString());

  // Non-disclosure (AC-07): чужий, неіснуючий і вже прибраний пункт -- однакова
  // відповідь, той самий код, що в контракті (plan_item.not_found -> 404).
  if (!updated) {
    throw new AppError('plan_item.not_found', 'Пункт плану не знайдено', 404);
  }

  // AC-05: факт зміни -- людською мовою, у той самий Лог дій, що картки й
  // Структура. Лише ПІСЛЯ успішного UPDATE: немає зміни -- немає й події.
  if (recordAction) {
    if (textChanges) {
      await recordAction(db, {
        ownerUserId,
        action: `Змінено текст пункту плану на «${updated.planText}»`,
      });
    }
    if (doneChanges) {
      await recordAction(db, {
        ownerUserId,
        action: updated.done
          ? `Позначено виконаним пункт плану «${updated.planText}»`
          : `Знято позначку виконання з пункту плану «${updated.planText}»`,
      });
    }
  }

  return updated;
}
