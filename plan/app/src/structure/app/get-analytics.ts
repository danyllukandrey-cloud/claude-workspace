// T14 -- App: getAnalytics use-case (sad.md §6 Critical flows 1/9/10, ADR-0001
// "never cache the aggregate -- recompute from raw card data every time").
//
// Orchestrates:
// - ../infra/postgres-repo.ts (T9) -- owner's Structure (layoutMode) + active
//   layout positions.
// - `getCardProgress` -- injected, the SOLE source of a card's progress/
//   hasMetricBlock/entryCount (AC-05). Never cached inside this module --
//   asked fresh on every single call, so a card-level correction (life-area-
//   card's own AC-12) is reflected immediately, without a separately stored
//   number anywhere in `structure`.
// - ../domain/aggregate.ts (T6/T7) -- pure functions: computeStructureAggregate
//   (AC-01/AC-13), computeLogicLayoutGaps (AC-06, layoutMode 'logic'),
//   flagUnmaintainedCards (AC-06b, layoutMode 'single'/'free'/null).
// - ../infra/history-repo.ts (T10) -- findHistoryEventsAsOf, for AC-07's gap
//   trend: reconstructs a card's PAST cellIndex from the latest 'moved' event
//   at/before `asOf`, parsing `detail` in the "cell_index -> N" shape (the
//   only shape currently used anywhere in this codebase -- data-model.md
//   leaves the exact format TBD). No such event -- trend is `null`, not an
//   error (T14 DoD: absence of history never fails the whole call).

import type { Db, LayoutModeRow } from '../infra/postgres-repo';
import { findStructureByOwner, listActiveLayoutPositionsByOwner } from '../infra/postgres-repo';
import { findHistoryEventsAsOf, type HistoryEventRecord } from '../infra/history-repo';
import {
  computeStructureAggregate,
  computeLogicLayoutGaps,
  flagUnmaintainedCards,
  computeGapTrend,
  type GapTrend,
} from '../domain/aggregate';

export type GetCardProgress = (cardId: string) => Promise<{
  progress: number | null;
  hasMetricBlock: boolean;
  entryCount: number;
}>;

export interface CardAnalytics {
  cardId: string;
  progress: number | null;
  gap: number | null;
  trend: GapTrend;
  unmaintained: boolean;
}

export interface StructureAnalyticsResult {
  layoutMode: LayoutModeRow | null;
  average: number | null;
  excludedCount: number;
  cards: CardAnalytics[];
}

/** Parses the only `detail` shape currently in use: "cell_index -> N". */
function parsePastCellIndex(detail: string | null): number | null {
  if (!detail) return null;
  const match = detail.match(/cell_index\s*->\s*(-?\d+)/);
  return match ? Number(match[1]) : null;
}

export async function getAnalytics(
  db: Db,
  input: { ownerUserId: string; asOf?: Date },
  getCardProgress: GetCardProgress
): Promise<StructureAnalyticsResult> {
  const structure = await findStructureByOwner(db, input.ownerUserId);
  const layoutMode = structure?.layoutMode ?? null;

  const positions = await listActiveLayoutPositionsByOwner(db, input.ownerUserId);

  const progressByCard = new Map<
    string,
    { progress: number | null; hasMetricBlock: boolean; entryCount: number }
  >();
  for (const position of positions) {
    progressByCard.set(position.cardId, await getCardProgress(position.cardId));
  }

  const { average, excludedCount } = computeStructureAggregate(
    positions.map((position) => ({
      cardId: position.cardId,
      cellIndex: position.cellIndex,
      progress: progressByCard.get(position.cardId)?.progress ?? null,
    }))
  );

  const maxIndex = positions.length - 1;
  const gapByCard = new Map<string, number>();
  const unmaintainedIds = new Set<string>();

  if (layoutMode === 'logic') {
    const gapInputs = positions
      .filter((position) => progressByCard.get(position.cardId)?.progress !== null)
      .map((position) => ({
        cardId: position.cardId,
        cellIndex: position.cellIndex,
        progress: progressByCard.get(position.cardId)!.progress as number,
      }));
    for (const gap of computeLogicLayoutGaps(gapInputs)) {
      gapByCard.set(gap.cardId, gap.gap);
    }
  } else {
    const unmaintained = flagUnmaintainedCards(
      positions.map((position) => ({
        cardId: position.cardId,
        hasMetricBlock: progressByCard.get(position.cardId)?.hasMetricBlock ?? false,
        entryCount: progressByCard.get(position.cardId)?.entryCount ?? 0,
      }))
    );
    for (const cardId of unmaintained) unmaintainedIds.add(cardId);
  }

  // AC-07 -- gap trend, only meaningful where a rank-based gap exists (logic
  // layout); non-logic layouts never show a gap, so trend stays null for them.
  const trendByCard = new Map<string, GapTrend>();
  if (layoutMode === 'logic' && structure) {
    const asOf = input.asOf ?? new Date();
    const history = await findHistoryEventsAsOf(db, structure.id, asOf);
    const latestMovedByCard = new Map<string, HistoryEventRecord>();
    for (const event of history) {
      // history is ordered ascending by occurred_at -- later entries overwrite
      // earlier ones, so this map ends up holding the LATEST event per card.
      if (event.eventType === 'moved') {
        latestMovedByCard.set(event.cardId, event);
      }
    }

    for (const position of positions) {
      const currentGap = gapByCard.get(position.cardId);
      const event = latestMovedByCard.get(position.cardId);
      const currentProgress = progressByCard.get(position.cardId)?.progress ?? null;
      const pastCellIndex = event ? parsePastCellIndex(event.detail) : null;

      if (currentGap === undefined || pastCellIndex === null || currentProgress === null) {
        trendByCard.set(position.cardId, null);
        continue;
      }

      const pastRank = maxIndex > 0 ? 1 - pastCellIndex / maxIndex : 1;
      const pastGap = pastRank - currentProgress;

      trendByCard.set(
        position.cardId,
        computeGapTrend([
          { gap: pastGap, occurredAt: event!.occurredAt.toISOString() },
          { gap: currentGap, occurredAt: asOf.toISOString() },
        ])
      );
    }
  }

  const cards: CardAnalytics[] = positions.map((position) => ({
    cardId: position.cardId,
    progress: progressByCard.get(position.cardId)?.progress ?? null,
    gap: gapByCard.get(position.cardId) ?? null,
    trend: trendByCard.get(position.cardId) ?? null,
    unmaintained: unmaintainedIds.has(position.cardId),
  }));

  return { layoutMode, average, excludedCount, cards };
}
