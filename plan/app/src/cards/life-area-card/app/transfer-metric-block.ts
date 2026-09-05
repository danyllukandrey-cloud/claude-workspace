// Use-case "перенести блок-метрику на іншу картку" (T17) -- приймає рішення,
// вже ухвалене користувачем при закритті картки (sad.md §6 Flow 12), і
// викликається API фічі structure. Сюди приходить готовий вибір: який блок
// переносити (metricBlockId) і, якщо користувач уже вирішив перейменувати
// блок при колізії, нова назва (newLabel) -- сам use-case нічого в
// користувача не питає, лише виконує рішення й перевіряє його на колізію.
//
// DI (ADR-0004): `db` приймається параметром, use-case сам жодного
// з'єднання не створює -- композицію робить викликач (composition root
// фічі structure чи ports-шар).
//
// Джерело (ISS-30, contracts/openapi.yaml MetricBlockTransferRequest):
// контракт передає лише metricBlockId, НЕ картку-джерело -- бекенд сам
// визначає, якій картці зараз належить блок (findMetricBlockById + block.cardId),
// не довіряючи заявленому викликачем значенню. Так і задумано з самого
// початку (api-sync-report.md) -- викликач не може підсунути невірну/чужу
// картку-джерело, бо її взагалі не передає.
//
// Non-disclosure (AC-04): і джерело (виведене з блоку), і призначення
// перевіряються через findCardById(db, ownerUserId, cardId). Контракт
// документує ОДИН код 404 на всі причини цього ендпоінту -- "цільова картка
// чи блок-метрика джерела не знайдені/не належать користувачу" ->
// 'card.not_found' -- тому неіснуючий metricBlockId, чужа картка-джерело й
// чужа картка-призначення дають той самий AppError, без розрізнення причини.
//
// Колізія назва+одиниця (AC-15): перевіряємо ПІД ефективною назвою (newLabel,
// якщо передано, інакше поточна label блоку) -- і без newLabel, і з newLabel,
// що сам по собі теж збігається з наявним блоком, результат один: відхилити
// (AppError, 409), а не мовчки злити два блоки в один. Код помилки --
// 'metric_block.name_collision', той самий, що вже задокументований у
// contracts/openapi.yaml (MetricBlockTransferRequest 409, зафіксовано
// 2026-08-27) -- НЕ вигадувати новий код тут.
//
// Порядок запису (AC-14): updateMetricBlock({cardId, label}) ОБОВ'ЯЗКОВО
// перед reassignEntriesToCard -- postgres-repo.ts прямо документує цю пару
// як обов'язкову (entry.card_id денормалізовано, перенесення блоку саме по
// собі не рухає його записи).

import {
  findCardById,
  findMetricBlockByCardLabelUnit,
  findMetricBlockById,
  reassignEntriesToCard,
  updateMetricBlock,
} from '../infra/postgres-repo';
import type { Db, MetricBlockRecord } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

export interface TransferMetricBlockInput {
  ownerUserId: string;
  targetCardId: string;
  metricBlockId: string;
  /** Нова назва блоку, якщо користувач уже вирішив перейменувати при колізії (AC-15). */
  newLabel?: string;
}

/**
 * Переносить блок-метрику (і всю його історію записів) із картки, якій вона
 * зараз належить, на targetCardId (AC-14). Колізія назва+одиниця в картці-
 * призначенні відхиляється (AC-15), якщо ефективна назва (newLabel ?? поточна
 * label) уже зайнята іншим блоком тієї ж картки -- жодного мовчазного злиття.
 */
export async function transferMetricBlock(db: Db, input: TransferMetricBlockInput): Promise<MetricBlockRecord> {
  const [block, targetCard] = await Promise.all([
    findMetricBlockById(db, input.metricBlockId),
    findCardById(db, input.ownerUserId, input.targetCardId),
  ]);
  const sourceCard = block ? await findCardById(db, input.ownerUserId, block.cardId) : null;

  if (!block || !sourceCard || !targetCard) {
    // Один код на всі причини (ISS-30) -- контракт не розрізняє "блок не
    // існує", "блок чужий" і "картка-призначення чужа/не існує".
    throw new AppError('card.not_found', 'Картку чи блок-метрику не знайдено', 404);
  }

  const effectiveLabel = input.newLabel ?? block.label;
  const collision = await findMetricBlockByCardLabelUnit(db, input.targetCardId, effectiveLabel, block.unit);
  if (collision) {
    // AC-15: збіг назва+одиниця в картці-призначенні -- відхиляємо, незалежно
    // від того, чи це колізія під старою назвою (newLabel не передано), чи
    // під новою (newLabel передано, але вона теж зайнята).
    throw new AppError('metric_block.name_collision', 'У картці-призначенні вже є блок із такою назвою й одиницею', 409);
  }

  const updated = await updateMetricBlock(db, input.metricBlockId, {
    cardId: input.targetCardId,
    label: effectiveLabel,
  });
  if (!updated) {
    // Теоретично недосяжно одразу після знаходження блоку вище, але форму
    // помилки дотримуємось ту саму, що й для "не знайдено" вище.
    throw new AppError('card.not_found', 'Картку чи блок-метрику не знайдено', 404);
  }

  // Обов'язкова пара з updateMetricBlock вище (postgres-repo.ts reassignEntriesToCard) --
  // entry.card_id денормалізовано, тому переносимо записи саме тепер, тим самим id.
  await reassignEntriesToCard(db, input.metricBlockId, input.targetCardId);

  return updated;
}
