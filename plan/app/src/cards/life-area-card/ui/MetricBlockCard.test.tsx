// D-110 (docs/DECISIONS.md, ТИМЧАСОВЕ рішення): кнопка "+" на кожній плитці
// блоку-метрики -- дозволяє живо ввести число (запис) і перевірити цикл
// блок-метрика -> запис -> прогрес, поки чат з агентом (реальний спосіб
// внесення запису, ux-flows.md US-01) не реалізований. Прибрати цю кнопку
// й ці тести, коли `agent`'s чат-інтерфейс візьме на себе внесення записів.
//
// Звичайний рендер (bounded/capped/ongoing/pending) уже покритий
// CardBack.test.tsx (композиція) -- тут RED-тести лише нової тимчасової
// поведінки onAddEntry, щоб не дублювати те, що вже перевірено (правило
// test-author).

import { fireEvent, render, screen } from '@testing-library/react';
import { MetricBlockCard } from './MetricBlockCard';
import type { MetricBlockViewModel } from './types';

function boundedBlock(overrides: Partial<MetricBlockViewModel> = {}): MetricBlockViewModel {
  return {
    id: 'mb1',
    label: 'Тренування',
    unit: 'раз',
    progress: { kind: 'bounded', share: 0.5, overGoal: 0 },
    hasPendingEntry: false,
    ...overrides,
  };
}

test('D-110: без onAddEntry кнопка "+" не рендериться (тимчасова функція опційна)', () => {
  render(<MetricBlockCard block={boundedBlock()} />);

  expect(screen.queryByRole('button', { name: '+' })).toBeNull();
});

test('D-110: з onAddEntry рендериться тимчасова кнопка "+"', () => {
  render(<MetricBlockCard block={boundedBlock()} onAddEntry={vi.fn()} />);

  expect(screen.getByRole('button', { name: '+' })).toBeTruthy();
});

test('D-110: клік на "+" розкриває поле числа й кнопку підтвердження, без виклику onAddEntry', () => {
  const onAddEntry = vi.fn();
  render(<MetricBlockCard block={boundedBlock()} onAddEntry={onAddEntry} />);

  fireEvent.click(screen.getByRole('button', { name: '+' }));

  expect(screen.getByLabelText('Кількість')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Додати' })).toBeTruthy();
  expect(onAddEntry).not.toHaveBeenCalled();
});

test('D-110: підтвердження введеного числа викликає onAddEntry(amount) і згортає поле назад', async () => {
  const onAddEntry = vi.fn().mockResolvedValue(undefined);
  render(<MetricBlockCard block={boundedBlock()} onAddEntry={onAddEntry} />);

  fireEvent.click(screen.getByRole('button', { name: '+' }));
  fireEvent.change(screen.getByLabelText('Кількість'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

  expect(onAddEntry).toHaveBeenCalledWith(5);
  await screen.findByRole('button', { name: '+' }); // повернулось до згорнутого стану
  expect(screen.queryByLabelText('Кількість')).toBeNull();
});

// Review 2026-09-07 C16: до цього фіксу відхилений onAddEntry був unhandled
// rejection -- ані повідомлення користувачу, ані повернення форми в
// нормальний стан (кнопка "Додати" лишалась активною, ніщо не підказувало,
// що запис НЕ зберігся).
test('C16: відхилення onAddEntry показує інлайн-помилку, поле не згортається, значення не втрачається', async () => {
  const onAddEntry = vi.fn().mockRejectedValue(new Error('Мережа недоступна'));
  render(<MetricBlockCard block={boundedBlock()} onAddEntry={onAddEntry} />);

  fireEvent.click(screen.getByRole('button', { name: '+' }));
  fireEvent.change(screen.getByLabelText('Кількість'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

  expect(await screen.findByText('Мережа недоступна')).toBeTruthy();
  expect(screen.getByLabelText('Кількість')).toBeTruthy(); // поле лишається відкритим -- користувач може повторити
  expect(screen.queryByRole('button', { name: '+' })).toBeNull(); // НЕ згорнулось назад
});

// Review 2026-09-07 C16: подвійний клік ("Додати" двічі поспіль, поки перший
// запит ще в польоті) до фіксу викликав onAddEntry двічі -- подвійний запис
// того самого числа.
test('C16: кнопка "Додати" недоступна, поки перший виклик onAddEntry ще в польоті -- подвійний клік не дає другого виклику', async () => {
  let resolveFirstCall: (() => void) | undefined;
  const onAddEntry = vi.fn().mockImplementation(
    () => new Promise<void>((resolve) => { resolveFirstCall = resolve; }),
  );
  render(<MetricBlockCard block={boundedBlock()} onAddEntry={onAddEntry} />);

  fireEvent.click(screen.getByRole('button', { name: '+' }));
  fireEvent.change(screen.getByLabelText('Кількість'), { target: { value: '5' } });
  const submitButton = screen.getByRole('button', { name: 'Додати' });
  fireEvent.click(submitButton);
  fireEvent.click(submitButton); // другий клік, поки перший запит ще не завершився

  expect(onAddEntry).toHaveBeenCalledTimes(1);
  expect(submitButton).toHaveProperty('disabled', true);

  resolveFirstCall?.();
  await screen.findByRole('button', { name: '+' }); // після завершення -- нормальне згортання
});
