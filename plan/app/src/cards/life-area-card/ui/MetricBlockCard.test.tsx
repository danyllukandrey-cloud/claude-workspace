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

// CH-03 (docs/features/life-area-card/changes.md): олівець редагування --
// правий нижній кут блоку, той самий опційний-проп патерн, що "×".

test('без onEdit олівець не рендериться взагалі', () => {
  render(<MetricBlockCard block={makeBlock()} />);

  expect(screen.queryByRole('button', { name: /Редагувати метрику/ })).toBeNull();
});

test('з onEdit олівець рендериться, клік викликає onEdit', () => {
  const onEdit = vi.fn();
  render(<MetricBlockCard block={makeBlock({ label: 'Тренування' })} onEdit={onEdit} />);

  fireEvent.click(screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' }));

  expect(onEdit).toHaveBeenCalledTimes(1);
});

// CH-02 (code review 2026-09-19, CardBack.tsx's "стан без вимірювань"):
// `disabled` -- справжній HTML-атрибут кнопок ×/✎, не лише CSS predка --
// блокує і клік, і Enter/Space із клавіатури (pointer-events-none на предку
// цього не робить).

test('disabled=true ставить справжній атрибут disabled на "×" і "✎", клік не викликає дії', () => {
  const onDelete = vi.fn();
  const onEdit = vi.fn();
  render(<MetricBlockCard block={makeBlock({ label: 'Тренування' })} onDelete={onDelete} onEdit={onEdit} disabled />);

  const deleteButton = screen.getByRole('button', { name: 'Видалити метрику «Тренування»' });
  const editButton = screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' });

  expect(deleteButton.hasAttribute('disabled')).toBe(true);
  expect(editButton.hasAttribute('disabled')).toBe(true);

  fireEvent.click(deleteButton);
  fireEvent.click(editButton);
  expect(onDelete).not.toHaveBeenCalled();
  expect(onEdit).not.toHaveBeenCalled();
});

test('без disabled (за замовчуванням) кнопки НЕ мають атрибута disabled', () => {
  render(<MetricBlockCard block={makeBlock({ label: 'Тренування' })} onDelete={vi.fn()} onEdit={vi.fn()} />);

  expect(screen.getByRole('button', { name: 'Видалити метрику «Тренування»' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: 'Редагувати метрику «Тренування»' }).hasAttribute('disabled')).toBe(false);
});
