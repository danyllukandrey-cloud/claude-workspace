// Use-case "додати блок-метрику до картки" (T16) -- sad.md §6 Critical flow
// 6/8, AC-05/AC-07/AC-08.
//
// AC-07 (допомога з невимірною ціллю) вирішується в чаті ДО цього виклику --
// цей use-case лише приймає вже узгоджений результат (label/unit + або
// targetCount, або isOngoing: true), сам нічого не "домовляється" і не
// перетворює розмиту ціль на вимірну.
//
// AC-05 (постійний процес без кінцевої дати) -- тут лише приймається прапорець
// isOngoing/відсутність targetDate; сам розрахунок частки виконання (ongoing
// vs відсоток) -- відповідальність рахунку прогресу (T6/T9 domain), не цього
// use-case.
//
// AC-08 (декларативна картка без жодного блоку) -- це стан самої картки
// (T9 domain), не поведінка цього use-case: досить, що виклик НІКОЛИ не чіпає
// таблицю `card` (лише `metric_block`) -- картка без виклику лишається
// декларативною автоматично, без окремого прапорця тут.
//
// DI (ADR-0004): `db` приймається параметром, use-case сам жодного зʼєднання
// не створює -- композицію робить викликач (ports/composition root).
//
// Non-disclosure (AC-04): findCardById(db, ownerUserId, cardId) повертає null
// і для чужої, і для неіснуючої картки -- власної перевірки власника тут не
// винаходимо. AppError('card.not_found', ..., 404) -- та сама форма, що й у
// T14/T15/T33 (ports-шар отримує один шаблон обробки non-disclosure на всі
// use-case картки).

import { randomUUID } from 'node:crypto';
import { findCardById, insertMetricBlock } from '../infra/postgres-repo';
import type { Db, MetricBlockRecord } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

export interface CreateMetricBlockInput {
  ownerUserId: string;
  cardId: string;
  label: string;
  unit: string;
  frequency?: string | null;
  /** Ціль «X з N» -- взаємовиключно з isOngoing, узгоджено в чаті ДО виклику (AC-07). */
  targetCount?: number | null;
  /** «Постійний процес», без кінцевої дати (AC-05) -- узгоджено в чаті ДО виклику. */
  isOngoing?: boolean;
  targetDate?: string | null;
}

/**
 * Додає новий блок-метрику до вже наявної картки.
 *
 * Non-disclosure (AC-04): чужа чи неіснуюча картка -- AppError('card.not_found', 404),
 * жодного запису в metric_block не станеться.
 *
 * Ownership картки перевіряється тут (findCardById); сам блок-метрика власного
 * owner_user_id не має (лише через card), як зазначено в postgres-repo.ts.
 */
export async function createMetricBlock(db: Db, input: CreateMetricBlockInput): Promise<MetricBlockRecord> {
  const card = await findCardById(db, input.ownerUserId, input.cardId);
  if (!card) {
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  return insertMetricBlock(db, {
    id: randomUUID(),
    cardId: input.cardId,
    label: input.label,
    unit: input.unit,
    frequency: input.frequency,
    targetCount: input.targetCount,
    isOngoing: input.isOngoing,
    targetDate: input.targetDate,
  });
}
