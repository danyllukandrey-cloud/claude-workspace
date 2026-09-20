// T9 -- компонентний тест екрана ПЛАН (spec.md AC-01/AC-03/AC-03b/AC-08/AC-11).
//
// DI-стиль той самий, що DeclarationScreen.test.tsx/CardFace.test.tsx:
// loadPlanItems/onToggleDone/onAddPlanItem/onOpenPlanItem -- ін'єктовані
// пропи-функції, жодного fetch() у самому компоненті.
//
// Що саме фіксують тести:
// - AC-08: три горизонти видно ОДНОЧАСНО, кожен зі своїми пунктами, станом
//   "виконано" і датою ДОДАВАННЯ (createdAt), а не датою редагування.
// - AC-03/AC-03b: чекбокс -- реверсивний тумблер; клік викликає onToggleDone
//   з новим значенням і НЕ прибирає пункт із горизонту.
// - AC-11: порожній горизонт показує власну кнопку "+" (додати перший пункт),
//   а не текст "порожньо" -- порожній екран у першого користувача має бути
//   робочим, не повідомленням про порожнечу.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlanScreen } from './PlanScreen';
import type { PlanScreenItem } from './PlanScreen';
import { AppError } from '../../shared/errors';

function items(): PlanScreenItem[] {
  return [
    {
      id: 'i1',
      horizon: 'tactical',
      planText: 'Пробігти 5 км без зупинки',
      done: false,
      createdAt: '2026-09-18T08:00:00.000Z',
    },
    {
      id: 'i2',
      horizon: 'tactical',
      planText: 'Закрити курс з англійської',
      done: true,
      createdAt: '2026-09-19T08:00:00.000Z',
    },
    {
      id: 'i3',
      horizon: 'strategic',
      planText: 'Побудувати дім',
      done: false,
      createdAt: '2026-09-20T08:00:00.000Z',
    },
  ];
}

function baseProps(loaded: PlanScreenItem[] = items()) {
  return {
    loadPlanItems: vi.fn().mockResolvedValue(loaded),
    onToggleDone: vi.fn().mockResolvedValue(undefined),
    onAddPlanItem: vi.fn(),
    onOpenPlanItem: vi.fn(),
    onSessionExpired: vi.fn(),
  };
}

function horizonSection(title: string): HTMLElement {
  return screen.getByRole('region', { name: new RegExp(title, 'i') });
}

test('loading: показує Spinner, поки список пунктів ще в польоті', () => {
  const loadPlanItems = vi.fn(() => new Promise<PlanScreenItem[]>(() => {}));

  render(
    <PlanScreen
      loadPlanItems={loadPlanItems}
      onToggleDone={vi.fn()}
      onAddPlanItem={vi.fn()}
      onOpenPlanItem={vi.fn()}
      onSessionExpired={vi.fn()}
    />
  );

  expect(screen.getByRole('status')).toBeTruthy();
});

test('AC-08: три горизонти одночасно, кожен зі своїми пунктами й датою додавання', async () => {
  const props = baseProps();
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByText('Пробігти 5 км без зупинки')).toBeTruthy());

  const tactical = horizonSection('Тактичний');
  expect(within(tactical).getByText('Пробігти 5 км без зупинки')).toBeTruthy();
  expect(within(tactical).getByText('Закрити курс з англійської')).toBeTruthy();
  // Дата додавання (createdAt), формат uk-UA дд.мм -- той самий, що в Лозі дій.
  expect(within(tactical).getByText('18.09')).toBeTruthy();
  expect(within(tactical).getByText('19.09')).toBeTruthy();

  const operational = horizonSection('Оперативний');
  expect(within(operational).queryByText('Пробігти 5 км без зупинки')).toBeNull();

  const strategic = horizonSection('Стратегічний');
  expect(within(strategic).getByText('Побудувати дім')).toBeTruthy();
});

test('AC-08: стан "виконано" видно на самому екрані, без відкривання редактора', async () => {
  const props = baseProps();
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByText('Закрити курс з англійської')).toBeTruthy());

  const done = screen.getByRole('checkbox', { name: 'Закрити курс з англійської' }) as HTMLInputElement;
  const notDone = screen.getByRole('checkbox', { name: 'Пробігти 5 км без зупинки' }) as HTMLInputElement;
  expect(done.checked).toBe(true);
  expect(notDone.checked).toBe(false);
});

test('AC-03: клік по чекбоксу викликає onToggleDone(true) і лишає пункт у тому самому горизонті', async () => {
  const props = baseProps();
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByText('Пробігти 5 км без зупинки')).toBeTruthy());

  fireEvent.click(screen.getByRole('checkbox', { name: 'Пробігти 5 км без зупинки' }));

  await waitFor(() => expect(props.onToggleDone).toHaveBeenCalledTimes(1));
  expect(props.onToggleDone).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'i1' }),
    true
  );
  // Позначення виконаним НІКОЛИ не прибирає пункт із виду.
  expect(within(horizonSection('Тактичний')).getByText('Пробігти 5 км без зупинки')).toBeTruthy();
});

test('AC-03b: повторний клік по вже виконаному пункті повертає його в "не виконано"', async () => {
  const props = baseProps();
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByText('Закрити курс з англійської')).toBeTruthy());

  fireEvent.click(screen.getByRole('checkbox', { name: 'Закрити курс з англійської' }));

  await waitFor(() => expect(props.onToggleDone).toHaveBeenCalledTimes(1));
  expect(props.onToggleDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'i2' }), false);

  const checkbox = screen.getByRole('checkbox', { name: 'Закрити курс з англійської' }) as HTMLInputElement;
  await waitFor(() => expect(checkbox.checked).toBe(false));
});

test('AC-11: перший запуск -- усі три горизонти порожні, кожен зі своєю кнопкою "+" і без повідомлення про порожнечу', async () => {
  const props = baseProps([]);
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByRole('region', { name: /Тактичний/i })).toBeTruthy());

  for (const title of ['Тактичний', 'Оперативний', 'Стратегічний']) {
    const section = horizonSection(title);
    expect(within(section).getByRole('button', { name: `Додати пункт: ${title}` })).toBeTruthy();
    expect(within(section).queryByText(/порожн/i)).toBeNull();
  }
});

test('AC-11: кнопка "+" непорожнього горизонту передає саме цей горизонт', async () => {
  const props = baseProps();
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByText('Побудувати дім')).toBeTruthy());

  fireEvent.click(
    within(horizonSection('Стратегічний')).getByRole('button', { name: 'Додати пункт: Стратегічний' })
  );

  expect(props.onAddPlanItem).toHaveBeenCalledWith('strategic');
});

test('AC-01/AC-04: клік по тексту вже наявного пункту відкриває редактор саме цього пункту', async () => {
  const props = baseProps();
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByText('Побудувати дім')).toBeTruthy());

  fireEvent.click(screen.getByText('Побудувати дім'));

  expect(props.onOpenPlanItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'i3' }));
  // Клік по тексту -- це редагування, не перемикання чекбокса.
  expect(props.onToggleDone).not.toHaveBeenCalled();
});

test('збій збереження чекбокса: показує помилку і повертає чекбокс у попередній стан', async () => {
  const props = baseProps();
  props.onToggleDone = vi.fn().mockRejectedValue(new Error('Мережа недоступна'));
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByText('Пробігти 5 км без зупинки')).toBeTruthy());

  const checkbox = screen.getByRole('checkbox', { name: 'Пробігти 5 км без зупинки' }) as HTMLInputElement;
  fireEvent.click(checkbox);

  await waitFor(() => expect(screen.getByText(/Мережа недоступна/)).toBeTruthy());
  expect(checkbox.checked).toBe(false);
});

// Review 2026-09-20 (stage-2): до цього фіксу невдале завантаження лишало
// екран у стані "loading" назавжди -- ні Banner, ні кнопки. Той самий
// шаблон, що DeckScreen.tsx (C14) уже має для GET /cards.

test('збій завантаження (мережева помилка, не 401): показує Banner і кнопку "Спробувати ще раз"', async () => {
  const props = baseProps();
  props.loadPlanItems = vi.fn().mockRejectedValue(new Error('Мережа недоступна'));
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByText(/Мережа недоступна/)).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Спробувати ще раз' })).toBeTruthy();
});

test('збій завантаження: клік "Спробувати ще раз" повторно викликає loadPlanItems', async () => {
  const props = baseProps();
  props.loadPlanItems = vi.fn().mockRejectedValueOnce(new Error('Мережа недоступна')).mockResolvedValueOnce(items());
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByRole('button', { name: 'Спробувати ще раз' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));

  await waitFor(() => expect(screen.getByText('Пробігти 5 км без зупинки')).toBeTruthy());
  expect(props.loadPlanItems).toHaveBeenCalledTimes(2);
});

test('AppError з httpStatus 401 викликає onSessionExpired замість Banner (не глухий кут)', async () => {
  const props = baseProps();
  props.loadPlanItems = vi.fn().mockRejectedValue(new AppError('auth.invalid_token', 'Сесія протермінована', 401));
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: 'Спробувати ще раз' })).toBeNull();
});

test('AC-08: дата додавання показує рік, коли він НЕ поточний -- не лише для стратегічного горизонту', async () => {
  const props = baseProps([
    {
      id: 'old',
      horizon: 'tactical',
      planText: 'Старий пункт з торішнього року',
      done: false,
      createdAt: '2025-03-15T08:00:00.000Z',
    },
    {
      id: 'new',
      horizon: 'tactical',
      planText: 'Свіжий пункт цього року',
      done: false,
      createdAt: '2026-09-18T08:00:00.000Z',
    },
  ]);
  render(<PlanScreen {...props} />);

  await waitFor(() => expect(screen.getByText('Старий пункт з торішнього року')).toBeTruthy());

  const tactical = horizonSection('Тактичний');
  expect(within(tactical).getByText('15.03.2025')).toBeTruthy();
  expect(within(tactical).getByText('18.09')).toBeTruthy();
});
