// Use-case "перенести блок-метрику на іншу картку" (T17) -- приймає рішення,
// вже ухвалене користувачем при закритті картки (sad.md §6 Flow 12), і
// викликається API фічі structure. Сюди приходить готовий вибір: куди
// переносити (targetCardId) і, якщо користувач уже вирішив перейменувати
// блок при колізії, нова назва (newLabel) -- сам use-case нічого в
// користувача не питає, лише виконує рішення й перевіряє його на колізію.
//
// DI (ADR-0004): `db` приймається параметром, use-case сам жодного
// з'єднання не створює -- композицію робить викликач (composition root
// фічі structure чи ports-шар).
//
// Non-disclosure (AC-04): і джерело, і призначення перевіряються через
// findCardById(db, ownerUserId, cardId) -- та сама картка виглядає
// однаково зовні і для чужого власника, і для неіснуючого id, тому обидві
// перевірки завершуються тим самим AppError('card.not_found', ..., 404),
// без окремої гілки "403 чужа".
//
// Колізія назва+одиниця (AC-15): postgres-repo.ts НЕ має findMetricBlockById --
// блок, що переноситься, шукаємо через наявний listMetricBlocksByCard(sourceCardId)
// + .find(), той самий підхід, що й у сусідніх use-case файлах, коли
// репозиторій свідомо не заводить одноразову read-функцію під один виклик.
// Колізію в картці-призначенні перевіряємо ПІД ефективною назвою (newLabel,
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
  listMetricBlocksByCard,
  reassignEntriesToCard,
  updateMetricBlock,
} from '../infra/postgres-repo';
import type { Db, MetricBlockRecord } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

export interface TransferMetricBlockInput {
  ownerUserId: string;
  sourceCardId: string;
  targetCardId: string;
  metricBlockId: string;
  /** Нова назва блоку, якщо користувач уже вирішив перейменувати при колізії (AC-15). */
  newLabel?: string;
}

/**
 * Переносить блок-метрику (і всю його історію записів) із sourceCardId на
 * targetCardId (AC-14). Колізія назва+одиниця в картці-призначенні
 * відхиляється (AC-15), якщо ефективна назва (newLabel ?? поточна label)
 * уже зайнята іншим блоком тієї ж картки -- жодного мовчазного злиття.
 */
export async function transferMetricBlock(db: Db, input: TransferMetricBlockInput): Promise<MetricBlockRecord> {
  const [sourceCard, targetCard] = await Promise.all([
    findCardById(db, input.ownerUserId, input.sourceCardId),
    findCardById(db, input.ownerUserId, input.targetCardId),
  ]);
  if (!sourceCard) {
    throw new AppError('card.not_found', 'Картку-джерело не знайдено', 404);
  }
  if (!targetCard) {
    throw new AppError('card.not_found', 'Картку-призначення не знайдено', 404);
  }

  const blocks = await listMetricBlocksByCard(db, input.sourceCardId);
  const block = blocks.find((b) => b.id === input.metricBlockId);
  if (!block) {
    throw new AppError('metric_block.not_found', 'Блок-метрику не знайдено', 404);
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
    throw new AppError('metric_block.not_found', 'Блок-метрику не знайдено', 404);
  }

  // Обов'язкова пара з updateMetricBlock вище (postgres-repo.ts reassignEntriesToCard) --
  // entry.card_id денормалізовано, тому переносимо записи саме тепер, тим самим id.
  await reassignEntriesToCard(db, input.metricBlockId, input.targetCardId);

  return updated;
}
