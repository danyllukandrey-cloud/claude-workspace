// Use-case "переглянути картку з прогресом" (T20) -- оркеструє T6
// (domain/progress.ts, capping AC-09b) + T10 (infra/postgres-repo.ts, читання
// картки/блоків/записів) + T12 (infra/claude-client.ts, перевірка на
// суперечність AC-10) -- sad.md §6 Critical flow 4/5.
//
// DI (ADR-0004): `db` приймається параметром, use-case сам жодного зʼєднання
// не створює -- композицію робить викликач (ports/composition root).
//
// Non-disclosure (AC-04): findCardById сам повертає null і для чужої, і для
// неіснуючої картки -- AppError('card.not_found', 404), та сама форма, що
// й у archive-card.ts/update-card.ts.
//
// Опційна ін'єкція побічної дії (той самий підхід, що closeStructurePosition
// в archive-card.ts): `callClaude` -- необов'язковий параметр. AC-10 явно
// каже "лише коли справді щось виявлено" -- а щоб і на кожен виклик не
// звертатись до Claude без потреби (латентність), перевірку взагалі
// підключає викликач, передаючи callClaude. Без нього use-case просто не
// звертається до T12 і не заповнює dataWarning -- не помилка, лише "перевірка
// поки не підключена".

import { computeProgress } from '../domain/progress';
import type { BoundedProgress, Progress, RawEntry } from '../domain/progress';
import { checkSuspiciousData } from '../infra/claude-client';
import { findCardById, listEntriesByMetricBlock, listMetricBlocksByCard } from '../infra/postgres-repo';
import type { CardRecord, Db, EntryRecord, MetricBlockRecord } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

export interface GetCardInput {
  ownerUserId: string;
  cardId: string;
}

/** Прогрес одного блоку-метрики, прокинутий з T6 як є (ongoing або bounded, вже capped). */
export interface MetricBlockProgress {
  metricBlock: MetricBlockRecord;
  progress: Progress;
}

export interface CardWithProgress {
  card: CardRecord;
  metricBlocks: MetricBlockProgress[];
  /**
   * Агрегат картки (AC-09): середнє `share` серед bounded-блоків. Ongoing-блоки
   * не мають частки (Critical flow 6 -- показуються як накопичена кількість,
   * не відсоток), тож у середнє не входять. Немає жодного bounded-блоку
   * (декларативна картка без метрики, AC-08, чи лише ongoing-блоки) -- агрегат null.
   */
  aggregateProgress: number | null;
  /** AC-10: пояснення агента, лише коли callClaude передано і справді щось виявлено. */
  dataWarning: string | null;
}

/** Сигнатура збігається з infra/claude-client.ts checkSuspiciousData. */
export type CallClaude = (prompt: string) => Promise<string>;

export async function getCardWithProgress(
  db: Db,
  input: GetCardInput,
  callClaude?: CallClaude
): Promise<CardWithProgress> {
  const card = await findCardById(db, input.ownerUserId, input.cardId);
  if (!card) {
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  const blocks = await listMetricBlocksByCard(db, card.id);

  const metricBlocks: MetricBlockProgress[] = [];
  const entriesByBlockId = new Map<string, EntryRecord[]>();
  for (const block of blocks) {
    const entries = await listEntriesByMetricBlock(db, block.id);
    entriesByBlockId.set(block.id, entries);

    const rawEntries: RawEntry[] = entries.map((entry) => ({ amount: entry.amount, status: entry.status }));
    const progress = computeProgress({ targetCount: block.targetCount, isOngoing: block.isOngoing }, rawEntries);
    metricBlocks.push({ metricBlock: block, progress });
  }

  const aggregateProgress = computeAggregateProgress(metricBlocks);

  let dataWarning: string | null = null;
  if (callClaude) {
    const factsText = buildFactsText(blocks, entriesByBlockId);
    dataWarning = await checkSuspiciousData(callClaude, card.description ?? '', factsText);
  }

  return { card, metricBlocks, aggregateProgress, dataWarning };
}

function computeAggregateProgress(metricBlocks: MetricBlockProgress[]): number | null {
  const boundedShares = metricBlocks
    .map((entry) => entry.progress)
    .filter((progress): progress is BoundedProgress => progress.kind === 'bounded')
    .map((progress) => progress.share);

  if (boundedShares.length === 0) {
    return null;
  }
  return boundedShares.reduce((sum, share) => sum + share, 0) / boundedShares.length;
}

/** Короткий текстовий опис фактів картки для T12 -- join останніх записів у рядок. */
function buildFactsText(blocks: MetricBlockRecord[], entriesByBlockId: Map<string, EntryRecord[]>): string {
  return blocks
    .map((block) => {
      const entries = entriesByBlockId.get(block.id) ?? [];
      const entriesText = entries.map((entry) => `${entry.amount} (${entry.status})`).join(', ');
      return `${block.label}: ${entriesText || 'немає записів'}`;
    })
    .join('; ');
}
