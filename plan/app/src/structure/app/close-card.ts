// App: closeCard use-case (T13) -- оркеструє infra/postgres-repo.ts
// (listActiveLayoutPositionsByOwner, той самий UPDATE-шаблон, що
// closeActiveLayoutPositionForCard уже використовує) + infra/history-repo.ts
// (insertHistoryEvent) + опційно life-area-card's transferMetricBlock
// (contracts/openapi.yaml, closeCard, POST /structure/layout/{cardId}).
//
// Порядок (кожен крок ДО наступного запису):
// 1. AC-03 (non-disclosure): картка без активної позиції власника --
//    structure.card_not_found, 404 -- той самий шаблон, що moveCard.ts.
// 2. AC-12: закриваємо активну позицію (status: 'active' -> 'closed').
// 3. AC-15: пишемо подію 'closed' у Літопис Структури, той самий механізм,
//    що rename/move (T10 insertHistoryEvent).
// 4. Опційні metricTransfers -- кожен ЦІЛКОМ делегується life-area-card's
//    transferMetricBlock (app -> cards, plan/app/CLAUDE.md); Структура сама
//    НІКОЛИ не пише в metric_block/entry. Відсутні/порожні metricTransfers --
//    жодного автоматичного переносу, метрики лишаються на закритій картці.
//
// DI (ADR-0004): db приходить ззовні, use-case сам з'єднання не створює.

import { listActiveLayoutPositionsByOwner } from '../infra/postgres-repo';
import type { Db } from '../infra/postgres-repo';
import { insertHistoryEvent } from '../infra/history-repo';
import { AppError } from '../../shared/errors';
import { transferMetricBlock } from '../../cards/life-area-card/app/transfer-metric-block';

export interface CloseCardMetricTransfer {
  metricBlockId: string;
  targetCardId: string;
  newLabel?: string;
}

export interface CloseCardInput {
  ownerUserId: string;
  cardId: string;
  metricTransfers?: CloseCardMetricTransfer[];
}

/**
 * Закриває активну позицію картки в розкладці Структури (AC-12) і записує
 * подію 'closed' у Літопис (AC-15). Опційні metricTransfers переносять
 * окремі блоки-метрики на інші картки через life-area-card's
 * transferMetricBlock -- без цього параметра відхилені метрики лишаються
 * на закритій картці, жодного автоматичного переносу.
 */
export async function closeCard(db: Db, input: CloseCardInput): Promise<void> {
  const activePositions = await listActiveLayoutPositionsByOwner(db, input.ownerUserId);
  const current = activePositions.find((position) => position.cardId === input.cardId);
  if (!current) {
    throw new AppError('structure.card_not_found', 'Картку не знайдено в розкладці Структури', 404);
  }

  await db.query(
    `UPDATE structure_layout_position
     SET status = 'closed', position_updated_at = now()
     WHERE card_id = $1 AND status = 'active'`,
    [input.cardId]
  );

  await insertHistoryEvent(db, {
    id: crypto.randomUUID(),
    structureId: current.structureId,
    cardId: input.cardId,
    eventType: 'closed',
  });

  for (const transfer of input.metricTransfers ?? []) {
    await transferMetricBlock(db, {
      ownerUserId: input.ownerUserId,
      targetCardId: transfer.targetCardId,
      metricBlockId: transfer.metricBlockId,
      newLabel: transfer.newLabel,
    });
  }
}
