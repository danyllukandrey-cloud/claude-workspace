// Use-case "вирішити запис" (T19) -- один механізм на три випадки (AC-06/AC-11/AC-12):
// вирішення конфлікту близьких за часом записів (викликається двічі, по разу на
// кожен запис пари, з протилежними резолюціями), підтвердження накопиченого
// pending-запису після повернення агента (один виклик 'confirm'), виправлення чи
// відкат запису з історії (один виклик 'reject', часто на вже підтверджений запис).
// Викликач (agent API) вирішує, ЯКИЙ це з трьох випадків -- цей use-case реалізує
// лише сам механізм переходу статусу, не оркестрацію трьох сценаріїв.
//
// DI (ADR-0004): `db` приймається параметром, use-case сам зʼєднання не створює --
// той самий принцип, що в archive-card.ts/update-card.ts.
//
// Non-disclosure (AC-04, той самий шаблон, що в archive-card.ts/update-card.ts):
// findCardById повертає null і для чужої, і для неіснуючої картки ->
// AppError('card.not_found', ..., 404). Для самого запису non-disclosure межа
// інша: postgres-repo.ts навмисно не має findEntryById (T10) -- належність
// entryId цій картці перевіряємо через listEntriesByCard + .find(), так само,
// як зробив би сам репозиторій. Не знайдено (чужий чи неіснуючий запис) ->
// AppError('entry.not_found', ..., 404) -- той самий код, що вже задекларований
// у contracts/openapi.yaml для POST /entries/{entryId}/resolve.
//
// Перехід статусу -- ЗАВЖДИ через domain/entry.ts (T7) confirmEntry/rejectEntry,
// потім persist через postgres-repo.updateEntryStatus. НІКОЛИ не видаляє рядок
// (AC-12 -- "запис лишається читомим"), лише позначає статус.

import { confirmEntry, rejectEntry } from '../domain/entry';
import type { Entry } from '../domain/entry';
import { findCardById, listEntriesByCard, updateEntryStatus } from '../infra/postgres-repo';
import type { EntryRecord, Db } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

export type EntryResolution = 'confirm' | 'reject';

export interface ResolveEntryInput {
  ownerUserId: string;
  cardId: string;
  entryId: string;
  resolution: EntryResolution;
}

/**
 * Переводить запис через confirm/reject (T7) -- викликач вирішує, який це з
 * трьох випадків (AC-06 вирішення конфлікту -- викликає це двічі, з протилежними
 * резолюціями на кожен запис пари; AC-11 підтвердження після повернення агента --
 * один виклик 'confirm'; AC-12 виправлення з історії -- один виклик 'reject',
 * часто на вже підтверджений запис). Non-disclosure (AC-04): чужа/неіснуюча
 * картка чи запис -- AppError 404, updateEntryStatus в цьому разі не викликається.
 */
export async function resolveEntry(db: Db, input: ResolveEntryInput): Promise<EntryRecord> {
  const card = await findCardById(db, input.ownerUserId, input.cardId);
  if (!card) {
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  // postgres-repo.ts навмисно не має findEntryById (T10, коментар до
  // updateEntryStatus) -- належність entryId цій картці перевіряємо, читаючи
  // список і шукаючи рядок, так само, як зробив би сам use-case-шар деінде.
  const entries = await listEntriesByCard(db, input.cardId);
  const record = entries.find((e) => e.id === input.entryId);
  if (!record) {
    throw new AppError('entry.not_found', 'Запис не знайдено', 404);
  }

  const entry: Entry = {
    id: record.id,
    metricBlockId: record.metricBlockId,
    amount: record.amount,
    status: record.status,
  };

  const applied = input.resolution === 'confirm' ? confirmEntry(entry) : rejectEntry(entry);

  const updated = await updateEntryStatus(db, input.entryId, applied.status);
  if (!updated) {
    // Теоретично недосяжно одразу після знайденого вище рядка, але
    // non-disclosure дотримуємось і тут -- жодних припущень назовні про причину null.
    throw new AppError('entry.not_found', 'Запис не знайдено', 404);
  }

  return updated;
}
