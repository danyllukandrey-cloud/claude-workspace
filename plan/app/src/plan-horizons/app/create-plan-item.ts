// T4 -- App: use-case "створити пункт плану" (POST /api/v1/plan-items,
// contracts/openapi.yaml createPlanItem). Оркеструє домен (T2, валідація
// тексту й горизонту) + репозиторій (T3, INSERT) + опційний запис у Лог дій
// (AC-05) -- той самий шаблон, що cards/life-area-card/app/create-card.ts і
// structure/app/create-connection.ts.
//
// DI (ADR-0004): `db` приходить параметром, use-case сам зʼєднання не
// створює і транзакцій не відкриває -- композицію робить викликач (ports).
//
// `ownerUserId` -- окремий позиційний параметр, а не поле input: його дає
// авторизований контекст запиту, а не тіло від клієнта. Той самий порядок
// аргументів, що в infra/postgres-repo.ts цієї ж фічі. Так клієнт фізично не
// може підсунути чужого власника (AC-07 вбудовано в форму сигнатури).
//
// `id` і мітка часу народжуються ТУТ, а не приймаються ззовні: контракт
// POST /plan-items приймає лише `horizon` + `planText`, і прокидати id з UI
// означало б зайвий параметр без жодної користі (те саме рішення, що в
// create-card.ts). Домен власного годинника не має -- момент часу підставляє
// цей шар (див. коментар у domain/plan-item.ts).
//
// PlanItemValidationError навмисно НЕ перехоплюється: вона вже несе свій код
// (plan_item.text_required / plan_item.horizon_invalid), який ports мапить у
// HTTP 422 -- і падає ДО insertPlanItem, тож порожній пункт не залишає в базі
// жодного сліду (AC-02).

import { randomUUID } from 'node:crypto';
import { createPlanItem as buildPlanItem } from '../domain/plan-item';
import type { PlanHorizon, PlanItem } from '../domain/plan-item';
import { insertPlanItem } from '../infra/postgres-repo';
import type { Db } from '../infra/postgres-repo';

export interface CreatePlanItemInput {
  horizon: PlanHorizon;
  planText: string;
}

/** Лог дій -- сигнатура збігається з agent/app/record-action.ts's `recordAction`. */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

export async function createPlanItem(
  db: Db,
  ownerUserId: string,
  input: CreatePlanItemInput,
  recordAction?: RecordAction
): Promise<PlanItem> {
  const now = new Date().toISOString();

  // Доменна збірка (T2) -- кидає PlanItemValidationError на порожній/пробільний
  // текст і на невідомий горизонт раніше за будь-який db.query. Повертає текст
  // уже без зайвих пробілів по краях, done: false, status: 'active'.
  const item = buildPlanItem({
    id: randomUUID(),
    ownerUserId,
    horizon: input.horizon,
    planText: input.planText,
    createdAt: now,
  });

  const created = await insertPlanItem(db, item);

  // AC-05: факт зміни -- людською мовою, у той самий Лог дій, що картки й
  // Структура. Лише ПІСЛЯ успішного INSERT: немає пункту -- немає й події.
  if (recordAction) {
    await recordAction(db, {
      ownerUserId,
      action: `Додано пункт плану «${created.planText}»`,
    });
  }

  return created;
}
