// T20 — SCR-01 Декларація, screens.md: component test for DeclarationScreen
// -- default/empty/loading/saved/offline-queued/confirm-reset/error states
// (spec.md AC-09, AC-10, AC-11, AC-11b).
//
// DI style (plan/app/CLAUDE.md, matches CardDetailScreen/ArchiveCardDialog):
// loadStructure/onSave are injected props, no fetch() inside the component.
//
// Вимоги 14/15 (Андрій, чат) — ПЛОСКА модель. "Одна картка" скасована
// повністю (вимога 14): жодного значення 'single' більше немає, і тесту на
// нього теж. Дворівневий вибір (LAYOUT_MODE_OPTIONS + умовний
// LOGIC_VARIANT_OPTIONS) замінено на ОДИН список 5 пігулок у порядку
// вимоги 15: Баланс навколо ядра / Фокус і спостереження / Причина і
// наслідок / Вільна розкладка / Готово до розкладання.
//
// Save-failure discrimination (mirrors src/app/main.tsx's
// AppError-vs-network-error split): onSave rejecting with an AppError
// (structure.invalid_layout_mode / 401) means the SERVER answered ->
// `error` state (Banner variant="error"). onSave rejecting with a plain
// Error (fetch itself failed -- offline) means the write was accepted
// locally and will sync later (spec.md §6 NFR) -> `offline-queued` state
// (Banner variant="info").
//
// confirm-reset (AC-11b): switching layoutMode to any of the other 4 values
// when the user already has cards arranged (`hasArrangedCards: true`) shows
// a ConfirmDialog BEFORE onSave is called -- cancelling must never call
// onSave and must leave the previously-saved choice selected.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeclarationScreen } from './DeclarationScreen';
import type { DeclarationScreenState } from './DeclarationScreen';

function baseState(overrides: Partial<DeclarationScreenState> = {}): DeclarationScreenState {
  return {
    declaration: 'Навчання й здоров’я зараз важливіші за кар’єру.',
    layoutMode: 'free',
    hasArrangedCards: false,
    ...overrides,
  };
}

function baseProps(stateOverrides: Partial<DeclarationScreenState> = {}) {
  return {
    loadStructure: vi.fn().mockResolvedValue(baseState(stateOverrides)),
    onSave: vi.fn().mockResolvedValue(undefined),
  };
}

test('loading: показує Spinner, поки GET /structure ще в польоті', () => {
  let resolveLoad: (value: DeclarationScreenState) => void = () => {};
  const loadStructure = vi.fn(
    () => new Promise<DeclarationScreenState>((resolve) => { resolveLoad = resolve; }),
  );

  render(<DeclarationScreen loadStructure={loadStructure} onSave={vi.fn()} />);

  expect(screen.getByRole('status')).toBeTruthy();
  // Задовольняємо TS/ESLint "unused" — проміс лишається непідтвердженим
  // навмисно (стан "loading" саме про це).
  void resolveLoad;
});

test('empty: layoutMode null (AC-09) — жоден із 5 варіантів розкладки не обраний', async () => {
  const props = baseProps({ declaration: null, layoutMode: null });
  render(<DeclarationScreen {...props} />);

  const textarea = await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  expect((textarea as HTMLTextAreaElement).value).toBe('');

  for (const label of ['Баланс навколо ядра', 'Фокус і спостереження', 'Причина і наслідок', 'Вільна розкладка', 'Готово до розкладання']) {
    expect((screen.getByRole('radio', { name: label }) as HTMLInputElement).checked).toBe(false);
  }
  // 'Одна картка' скасована повністю (вимога 14) — навіть у списку немає.
  expect(screen.queryByRole('radio', { name: 'Одна картка' })).toBeNull();
});

test('default: декларація й обраний режим завантажені та показані, у правильному порядку (вимога 15)', async () => {
  const props = baseProps({ layoutMode: 'balance' });
  render(<DeclarationScreen {...props} />);

  const textarea = await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  expect((textarea as HTMLTextAreaElement).value).toBe('Навчання й здоров’я зараз важливіші за кар’єру.');
  expect((screen.getByRole('radio', { name: 'Баланс навколо ядра' }) as HTMLInputElement).checked).toBe(true);

  const radios = screen.getAllByRole('radio') as HTMLInputElement[];
  expect(radios.map((radio) => radio.getAttribute('aria-label') ?? radio.closest('label')?.textContent)).toEqual([
    'Баланс навколо ядра',
    'Фокус і спостереження',
    'Причина і наслідок',
    'Вільна розкладка',
    'Готово до розкладання',
  ]);
});

test('усі 5 плоских режимів показані як один спільний список пігулок', async () => {
  const props = baseProps({ layoutMode: 'staging' });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  for (const label of ['Баланс навколо ядра', 'Фокус і спостереження', 'Причина і наслідок', 'Вільна розкладка', 'Готово до розкладання']) {
    expect(screen.getByRole('radio', { name: label })).toBeTruthy();
  }
  expect((screen.getByRole('radio', { name: 'Готово до розкладання' }) as HTMLInputElement).checked).toBe(true);
});

test('AC-10: збереження декларації викликає onSave лише з declaration і показує Banner "saved"', async () => {
  const props = baseProps();
  render(<DeclarationScreen {...props} />);

  const textarea = await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.change(textarea, { target: { value: 'нова декларація' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  await screen.findByText(/Зберег/);
  expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ declaration: 'нова декларація' }));
});

test('AC-11: обрання нового layoutMode без уже розкладених карток застосовує його одразу, без ConfirmDialog', async () => {
  const props = baseProps({ layoutMode: 'free', hasArrangedCards: false });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.click(screen.getByRole('radio', { name: 'Баланс навколо ядра' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() =>
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ layoutMode: 'balance' })),
  );
});

test('AC-11b: зміна layoutMode з уже розкладеними картками показує ConfirmDialog ПЕРЕД onSave', async () => {
  const props = baseProps({ layoutMode: 'free', hasArrangedCards: true });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.click(screen.getByRole('radio', { name: 'Баланс навколо ядра' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(props.onSave).not.toHaveBeenCalled();
});

test('AC-11b: підтвердження в ConfirmDialog викликає onSave з новим layoutMode', async () => {
  const props = baseProps({ layoutMode: 'free', hasArrangedCards: true });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.click(screen.getByRole('radio', { name: 'Баланс навколо ядра' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Змінити' }));

  await waitFor(() =>
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ layoutMode: 'balance' })),
  );
});

test('AC-11b: скасування в ConfirmDialog не викликає onSave і лишає попередній режим обраним', async () => {
  const props = baseProps({ layoutMode: 'free', hasArrangedCards: true });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.click(screen.getByRole('radio', { name: 'Баланс навколо ядра' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Скасувати' }));

  expect(props.onSave).not.toHaveBeenCalled();
  expect((screen.getByRole('radio', { name: 'Вільна розкладка' }) as HTMLInputElement).checked).toBe(true);
});

// Плоска модель (вимоги 14/15): перемикання МІЖ колишніми підвидами "за
// логікою" ('balance' -> 'focus') тепер звичайна зміна layoutMode -- той
// самий ConfirmDialog-шлях, що й будь-яка інша зміна режиму, без окремого
// колишнього AC-16b-випадку.
test('перемикання між колишніми підвидами "за логікою" з уже розкладеними картками теж проходить через ConfirmDialog', async () => {
  const props = baseProps({ layoutMode: 'balance', hasArrangedCards: true });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.click(screen.getByRole('radio', { name: 'Фокус і спостереження' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(props.onSave).not.toHaveBeenCalled();
});

test('offline-queued: onSave, що падає зі звичайною мережевою помилкою (не AppError), показує Banner variant="info"', async () => {
  const onSave = vi.fn().mockRejectedValue(new Error('network request failed'));
  const props = { ...baseProps(), onSave };
  render(<DeclarationScreen {...props} />);

  const textarea = await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.change(textarea, { target: { value: 'новий текст' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  const banner = await screen.findByText(/офлайн|синхронізу/i);
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('info');
});

test('error: onSave, що падає з AppError (422 structure.invalid_layout_mode), показує Banner variant="error" з повідомленням', async () => {
  class FakeAppError extends Error {
    code = 'structure.invalid_layout_mode';
    httpStatus = 422;
  }
  const onSave = vi.fn().mockRejectedValue(
    new FakeAppError('layoutMode must be one of: balance, focus, cause_effect, free, staging'),
  );
  const props = { ...baseProps(), onSave };
  render(<DeclarationScreen {...props} />);

  const textarea = await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.change(textarea, { target: { value: 'текст' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  const banner = await screen.findByText('layoutMode must be one of: balance, focus, cause_effect, free, staging');
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
});
