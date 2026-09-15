// Use-case "архівувати блок-метрику" (US-17/AC-20, D-127) -- мʼяка архівація
// ОДНОГО блоку-метрики, не всієї картки: status переходить 'active' -> 'archived'
// через postgres-repo.updateMetricBlock (той самий генеричний патч, що вже вміє
// status для card.updateCard), блок зникає зі звичайного списку картки
// (ports/metric-block-handlers.ts listMetricBlocks фільтрує лише 'active'),
// лишається технічно читомим (findMetricBlockById не фільтрує за status) і
// НІКОЛИ фізично не видаляється -- той самий підхід, що archiveCard (card.status)
// і entry.status (ADR-0002).
//
// DI (ADR-0004): `db` приймається параметром, use-case сам жодного з'єднання
// не створює -- той самий принцип, що archive-card.ts/transfer-metric-block.ts.
//
// Non-disclosure + не довіряємо client cardId (ISS-30, той самий підхід, що
// transfer-metric-block.ts для картки-джерела): контракт передає cardId у
// шляху (DELETE /cards/{cardId}/metric-blocks/{metricBlockId}), але бекенд
// САМ визначає, якій картці зараз належить блок -- через findMetricBlockById +
// block.cardId, а не через client-supplied cardId. Сам client-supplied cardId
// звіряється лише ПІСЛЯ підтвердження власності (block.cardId !== input.cardId) --
// невідповідний cardId у шляху дає той самий код 404, що й "блок не знайдено"
// чи "блок чужий", жодна з трьох причин не розрізняється назовні.
//
// Ідемпотентність: жодної перевірки "вже архівований" немає навмисно -- той
// самий підхід, що archiveCard (повторний виклик на вже archived картку не
// кидає помилку, лише оновлює updated_at). Контракт цього ендпоінту (DELETE)
// теж не документує окремого коду для "вже архівовано".

import { findCardById, findMetricBlockById, updateMetricBlock } from '../infra/postgres-repo';
import type { Db, MetricBlockRecord } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

export interface ArchiveMetricBlockInput {
  ownerUserId: string;
  /** cardId зі шляху DELETE -- НЕ довіряємо для авторизації (див. коментар вгорі файлу), лише звіряємо ПІСЛЯ. */
  cardId: string;
  metricBlockId: string;
}

export async function archiveMetricBlock(db: Db, input: ArchiveMetricBlockInput): Promise<MetricBlockRecord> {
  const block = await findMetricBlockById(db, input.metricBlockId);
  const card = block ? await findCardById(db, input.ownerUserId, block.cardId) : null;

  // Один код на всі причини (ISS-30, non-disclosure AC-04): блок не існує,
  // блок чужий (card === null через block.cardId), або URL адресує блок через
  // невідповідну картку (block.cardId !== input.cardId) -- жодна з причин не
  // розрізняється назовні.
  if (!block || !card || block.cardId !== input.cardId) {
    throw new AppError('card.not_found', 'Картку чи блок-метрику не знайдено', 404);
  }

  const archived = await updateMetricBlock(db, input.metricBlockId, { status: 'archived' });
  if (!archived) {
    // Теоретично недосяжно одразу після знаходження блоку вище, та сама
    // форма помилки, що архівація картки (archive-card.ts).
    throw new AppError('card.not_found', 'Картку чи блок-метрику не знайдено', 404);
  }

  return archived;
}
