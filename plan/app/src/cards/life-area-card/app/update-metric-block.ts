// Use-case "виправити блок-метрику" (CH-03, docs/features/life-area-card/changes.md) --
// перейменування й зміна налаштувань (ціль/одиниця/частота) БЕЗ перенесення
// на іншу картку -- перенесення й далі робить наявний app/transfer-metric-block.ts
// (CH-03 юзер-кейс п.3: "нового бекенду для цієї дії не треба").
//
// DI (ADR-0004): `db` приймається параметром, use-case сам жодного з'єднання
// не створює -- той самий принцип, що archive-metric-block.ts/transfer-metric-block.ts.
//
// Non-disclosure + не довіряємо client cardId (ISS-30, той самий підхід, що
// archive-metric-block.ts): контракт передає cardId у шляху (PATCH
// /cards/{cardId}/metric-blocks/{metricBlockId}), бекенд САМ визначає, якій
// картці зараз належить блок -- через findMetricBlockById + block.cardId, а
// не через client-supplied cardId. Невідповідний cardId у шляху дає той
// самий код 404, що й "блок не знайдено" чи "блок чужий".
//
// Колізія назва+одиниця (той самий підхід, що AC-15/transfer-metric-block.ts):
// перевіряємо лише коли ефективна назва+одиниця РЕАЛЬНО змінюється (інакше
// блок завжди "зіткнувся б сам із собою") -- і саме в межах ТІЄЇ САМОЇ картки
// (перенесення тут не відбувається, блок лишається на своїй картці).

import {
  findCardById,
  findMetricBlockByCardLabelUnit,
  findMetricBlockById,
  updateMetricBlock as updateMetricBlockRow,
} from '../infra/postgres-repo';
import type { Db, MetricBlockRecord } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

/** Лог дій -- сигнатура збігається з agent/app/record-action.ts's `recordAction` (create-card.ts докладніше). */
export type RecordAction = (db: Db, input: { ownerUserId: string; action: string }) => Promise<void>;

export interface UpdateMetricBlockInput {
  ownerUserId: string;
  /** cardId зі шляху -- НЕ довіряємо для авторизації (див. коментар вгорі файлу), лише звіряємо ПІСЛЯ. */
  cardId: string;
  metricBlockId: string;
  /** Нова назва (перейменування), якщо передано в цьому виклику. */
  label?: string;
  unit?: string;
  frequency?: string | null;
  /** Ціль «X з N»; `null` -- очищає ціль (взаємовиключно з isOngoing, той самий інваріант, що create-metric-block.ts). */
  targetCount?: number | null;
  isOngoing?: boolean;
  targetDate?: string | null;
}

export async function updateMetricBlock(
  db: Db,
  input: UpdateMetricBlockInput,
  recordAction?: RecordAction
): Promise<MetricBlockRecord> {
  const block = await findMetricBlockById(db, input.metricBlockId);
  const card = block ? await findCardById(db, input.ownerUserId, block.cardId) : null;

  // Один код на всі причини (ISS-30, non-disclosure AC-04) -- той самий
  // патерн, що archive-metric-block.ts: блок не існує, блок чужий, чи URL
  // адресує блок через невідповідну картку.
  if (!block || !card || block.cardId !== input.cardId) {
    throw new AppError('card.not_found', 'Картку чи блок-метрику не знайдено', 404);
  }

  // Review 2026-09-07 B6 (create-metric-block.ts, той самий захист): targetCount<=0
  // -- "отруйний" запис, computeProgress кидає ProgressValidationError на
  // кожне наступне відкриття картки. Відхиляємо ДО запису.
  if (input.targetCount != null && input.targetCount <= 0) {
    throw new AppError('metric_block.invalid_target_count', 'Ціль має бути додатним числом', 422);
  }

  const effectiveLabel = input.label ?? block.label;
  const effectiveUnit = input.unit ?? block.unit;
  const labelOrUnitChanged = effectiveLabel !== block.label || effectiveUnit !== block.unit;

  if (labelOrUnitChanged) {
    const collision = await findMetricBlockByCardLabelUnit(db, block.cardId, effectiveLabel, effectiveUnit);
    // Колізія з ІНШИМ блоком тієї ж картки -- відхиляємо, не зливаємо мовчки
    // (той самий код, що AC-15/transfer-metric-block.ts). Колізія з самим
    // собою (запис, що читаємо, -- це block.id) не рахується.
    if (collision && collision.id !== block.id) {
      throw new AppError('metric_block.name_collision', 'У картці вже є блок із такою назвою й одиницею', 409);
    }
  }

  const patch: {
    label?: string;
    unit?: string;
    frequency?: string | null;
    targetCount?: number | null;
    isOngoing?: boolean;
    targetDate?: string | null;
  } = {};
  if (input.label !== undefined) patch.label = input.label;
  if (input.unit !== undefined) patch.unit = input.unit;
  if (input.frequency !== undefined) patch.frequency = input.frequency;
  if (input.targetCount !== undefined) patch.targetCount = input.targetCount;
  if (input.isOngoing !== undefined) patch.isOngoing = input.isOngoing;
  if (input.targetDate !== undefined) patch.targetDate = input.targetDate;

  const updated = await updateMetricBlockRow(db, input.metricBlockId, patch);
  if (!updated) {
    // Теоретично недосяжно одразу після знаходження блоку вище, та сама
    // форма помилки, що archive-metric-block.ts.
    throw new AppError('card.not_found', 'Картку чи блок-метрику не знайдено', 404);
  }

  if (recordAction) {
    await recordAction(db, {
      ownerUserId: input.ownerUserId,
      action: `Змінено налаштування блоку-метрики «${updated.label}» на картці «${card.name}»`,
    });
  }

  return updated;
}
