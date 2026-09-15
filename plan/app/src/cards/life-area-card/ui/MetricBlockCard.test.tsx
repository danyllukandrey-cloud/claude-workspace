import { fireEvent, render, screen } from '@testing-library/react';
import { MetricBlockCard } from './MetricBlockCard';
import type { MetricBlockViewModel } from './types';

// Видалення блоку-метрики: кнопка "×" -- опційна (той самий патерн, що
// onCreateMetricBlock у CardBack), тому кожен стан тут тригериться передачею
// (чи ні) onDelete, не лише монтуванням.

function makeBlock(overrides: Partial<MetricBlockViewModel> = {}): MetricBlockViewModel {
  return {
    id: 'mb1',
    label: 'Тренування',
    unit: 'раз',
    progress: { kind: 'bounded', share: 0.5, overGoal: 0 },
    hasPendingEntry: false,
    ...overrides,
  };
}

test('без onDelete кнопка "×" не рендериться взагалі', () => {
  render(<MetricBlockCard block={makeBlock()} />);

  expect(screen.queryByRole('button', { name: /Видалити метрику/ })).toBeNull();
});

test('з onDelete кнопка "×" рендериться, клік викликає onDelete', () => {
  const onDelete = vi.fn();
  render(<MetricBlockCard block={makeBlock({ label: 'Тренування' })} onDelete={onDelete} />);

  fireEvent.click(screen.getByRole('button', { name: 'Видалити метрику «Тренування»' }));

  expect(onDelete).toHaveBeenCalledTimes(1);
});
