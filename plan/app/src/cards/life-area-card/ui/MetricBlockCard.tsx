// Одна плитка прогресу на звороті картки (SCR-03, T26) -- показує ОДИН
// блок-метрику: bounded-ціль як частку (AC-09), capped-варіант зі
// значенням "понад ціль" окремо (AC-09b), або ongoing-варіант як накопичену
// кількість замість відсотка (AC-05). Позначку "очікує" додає окремо
// (AC-06/AC-11) -- сам компонент не знає ПРИЧИНУ pending (конфлікт пристроїв
// чи недоступність агента), лише факт "є запис, що ще не порахований".
//
// D-110 (docs/DECISIONS.md, ТИМЧАСОВЕ рішення): опційний `onAddEntry` додає
// кнопку "+", що розкриває поле "Кількість" і кнопку "Додати" -- дозволяє
// живо ввести запис і перевірити цикл блок-метрика -> запис -> прогрес, поки
// реальний спосіб внесення запису (чат з агентом, ux-flows.md US-01) ще не
// реалізований. Прибрати цю кнопку разом з onAddEntry й MetricBlockCard.test.tsx
// (D-110-тести), коли агентський чат-інтерфейс візьме на себе внесення записів.
import { useState } from 'react';
import { Button, NumberField } from '../../../shared/ui';
import type { MetricBlockViewModel } from './types';

export interface MetricBlockCardProps {
  block: MetricBlockViewModel;
  /** ТИМЧАСОВО (D-110) -- вносить запис (кількість) для цього блоку. Відсутній -- кнопка "+" не рендериться. */
  onAddEntry?: (amount: number) => Promise<void>;
}

export function MetricBlockCard({ block, onAddEntry }: MetricBlockCardProps): JSX.Element {
  const { progress } = block;
  const [isAddingEntry, setIsAddingEntry] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);

  const handleAddEntry = (): void => {
    if (!onAddEntry || amount === null) return;
    onAddEntry(amount).then(() => {
      setIsAddingEntry(false);
      setAmount(null);
    });
  };

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
      {onAddEntry &&
        (isAddingEntry ? (
          <div>
            <NumberField label="Кількість" value={amount} onChange={setAmount} />
            <Button label="Додати" onClick={handleAddEntry} />
          </div>
        ) : (
          <Button label="+" onClick={() => setIsAddingEntry(true)} />
        ))}
    </div>
  );
}
