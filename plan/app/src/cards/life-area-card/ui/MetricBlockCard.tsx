// Одна плитка прогресу на звороті картки (SCR-03, T26) -- показує ОДИН
// блок-метрику: bounded-ціль як частку (AC-09), capped-варіант зі
// значенням "понад ціль" окремо (AC-09b), або ongoing-варіант як накопичену
// кількість замість відсотка (AC-05). Позначку "очікує" додає окремо
// (AC-06/AC-11) -- сам компонент не знає ПРИЧИНУ pending (конфлікт пристроїв
// чи недоступність агента), лише факт "є запис, що ще не порахований".
import type { MetricBlockViewModel } from './types';

export interface MetricBlockCardProps {
  block: MetricBlockViewModel;
}

export function MetricBlockCard({ block }: MetricBlockCardProps): JSX.Element {
  const { progress } = block;

  return (
    <div>
      {progress.kind === 'ongoing' ? (
        <p>
          {block.label}: постійний процес — {progress.accumulated} {block.unit}
        </p>
      ) : (
        <p>
          {block.label}: {Math.round(progress.share * 100)}%
          {progress.overGoal > 0 && (
            <span>
              {' '}
              (+{progress.overGoal} {block.unit} понад ціль)
            </span>
          )}
        </p>
      )}
      {block.hasPendingEntry && <p>Запис очікує перевірки агента</p>}
    </div>
  );
}
