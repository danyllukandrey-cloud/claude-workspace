// Одна плитка прогресу на звороті картки (SCR-03, T26) -- показує ОДИН
// блок-метрику: bounded-ціль як частку (AC-09), capped-варіант зі
// значенням "понад ціль" окремо (AC-09b), або ongoing-варіант як накопичену
// кількість замість відсотка (AC-05). Позначку "очікує" додає окремо
// (AC-06/AC-11) -- сам компонент не знає ПРИЧИНУ pending (конфлікт пристроїв
// чи недоступність агента), лише факт "є запис, що ще не порахований".
//
// D-120: тут немає готового дискретного статусу (лише число прогресу) --
// нейтральний accent/ink стиль, БЕЗ світлофора (good/warn/bad) -- той
// зарезервовано для EntryHistoryList, де є справжній entry.status.
import type { MetricBlockViewModel } from './types';

export interface MetricBlockCardProps {
  block: MetricBlockViewModel;
}

export function MetricBlockCard({ block }: MetricBlockCardProps): JSX.Element {
  const { progress } = block;

  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-surface-solid p-4">
      {progress.kind === 'ongoing' ? (
        <p className="text-ink">
          <span className="font-display text-lg font-bold text-accent">
            {block.label}: постійний процес — {progress.accumulated} {block.unit}
          </span>
        </p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-ink">
          <span className="font-display text-2xl font-bold text-accent">
            {block.label}: {Math.round(progress.share * 100)}%
          </span>
          {progress.overGoal > 0 && (
            <span className="text-xs font-medium text-ink-muted">
              {' '}
              (+{progress.overGoal} {block.unit} понад ціль)
            </span>
          )}
        </p>
      )}
      {block.hasPendingEntry && <p className="text-xs font-medium text-ink-muted">Запис очікує перевірки агента</p>}
    </div>
  );
}
