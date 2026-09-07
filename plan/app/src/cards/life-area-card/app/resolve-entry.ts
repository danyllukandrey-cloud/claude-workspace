// Use-case "вирішити запис" (T19) -- один механізм на три випадки (AC-06/AC-11/AC-12):
// вирішення конфлікту близьких за часом записів (викликається двічі, по разу на
// кожен запис пари, з протилежними резолюціями), підтвердження накопиченого
// pending-запису після повернення агента (один виклик 'confirmed'), виправлення чи
// відкат запису з історії (один виклик 'rejected', часто на вже підтверджений запис).
// Викликач (agent API) вирішує, ЯКИЙ це з трьох випадків -- цей use-case реалізує
// лише сам механізм переходу статусу, не оркестрацію трьох сценаріїв.
//
// DI (ADR-0004): `db` приймається параметром, use-case сам зʼєднання не створює --
// той самий принцип, що в archive-card.ts/update-card.ts.
//
// Джерело (ISS-32, contracts/openapi.yaml PATCH /entries/{entryId}): контракт
// передає лише entryId (шлях) + status (тіло), НЕ картку -- бекенд сам визначає,
// якій картці запис належить (findEntryById + record.cardId), не довіряючи
// заявленому викликачем значенню. Той самий підхід, що transferMetricBlock (T17,
// ISS-30) для картки-джерела блоку.
//
// Non-disclosure (AC-04): контракт документує ОДИН код 404 --
// 'entry.not_found' -- на "запис не знайдений" і "запис не належить
// користувачу" водночас; не розрізняємо ці дві причини окремими кодами.
//
// Поле входу -- `status` (не `resolution`), значення 'confirmed'/'rejected'
// (не 'confirm'/'reject') -- точно як EntryResolve контракту (ISS-32),
// не довільна внутрішня назва.
//
// Перехід статусу -- ЗАВЖДИ через domain/entry.ts (T7) confirmEntry/rejectEntry,
// потім persist через postgres-repo.updateEntryStatus. НІКОЛИ не видаляє рядок
// (AC-12 -- "запис лишається читомим"), лише позначає статус.

import { confirmEntry, rejectEntry } from '../domain/entry';
import type { Entry } from '../domain/entry';
import { findCardById, findEntryById, updateEntryStatus } from '../infra/postgres-repo';
import type { EntryRecord, Db } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

/** Точно значення EntryResolve.status контракту -- не 'pending', resolveEntry його ніколи не встановлює. */
export type EntryResolutionStatus = 'confirmed' | 'rejected';

export interface ResolveEntryInput {
  ownerUserId: string;
  entryId: string;
  status: EntryResolutionStatus;
}

/**
 * Переводить запис через confirm/reject (T7) -- викликач вирішує, який це з
 * трьох випадків (AC-06 вирішення конфлікту -- викликає це двічі, з протилежними
 * status на кожен запис пари; AC-11 підтвердження після повернення агента --
 * один виклик 'confirmed'; AC-12 виправлення з історії -- один виклик 'rejected',
 * часто на вже підтверджений запис). Non-disclosure (AC-04): чужий/неіснуючий
 * запис -- AppError('entry.not_found', 404), updateEntryStatus в цьому разі не викликається.
 */
export async function resolveEntry(db: Db, input: ResolveEntryInput): Promise<EntryRecord> {
  const record = await findEntryById(db, input.entryId);
  const card = record ? await findCardById(db, input.ownerUserId, record.cardId) : null;

  if (!record || !card) {
    // Один код на обидві причини (ISS-32) -- контракт не розрізняє "запис не
    // існує" від "запис чужий".
    throw new AppError('entry.not_found', 'Запис не знайдено', 404);
  }

  // Review 2026-09-07 (backend hardening, T50): ports-шар передає `status`
  // з тіла HTTP-запиту без валідації проти enum контракту -- будь-що, що не
  // є ЛІТЕРАЛЬНО 'confirmed', раніше мовчки трактувалось як 'rejected'.
  // Типо в запиті відхиляв би запис, а не сигналізував про помилку.
  if (input.status !== 'confirmed' && input.status !== 'rejected') {
    throw new AppError('entry.invalid_status', 'status має бути "confirmed" або "rejected"', 422);
  }

  const entry: Entry = {
    id: record.id,
    metricBlockId: record.metricBlockId,
    amount: record.amount,
    status: record.status,
  };

  const applied = input.status === 'confirmed' ? confirmEntry(entry) : rejectEntry(entry);

  const updated = await updateEntryStatus(db, input.entryId, applied.status);
  if (!updated) {
    // Теоретично недосяжно одразу після знайденого вище рядка, але
    // non-disclosure дотримуємось і тут -- жодних припущень назовні про причину null.
    throw new AppError('entry.not_found', 'Запис не знайдено', 404);
  }

  return updated;
}
