// RED (T20 — SCR-01 Декларація, screens.md): component test for
// DeclarationScreen -- default/empty/loading/saved/offline-queued/
// confirm-reset/error states (spec.md AC-09, AC-10, AC-11, AC-11b, AC-16,
// AC-16b). Component does not exist yet -- this is the RED step, no
// production code written (test-author role).
//
// DI style (plan/app/CLAUDE.md, matches CardDetailScreen/ArchiveCardDialog):
// loadStructure/onSave are injected props, no fetch() inside the component.
//
// Save-failure discrimination (mirrors src/app/main.tsx's
// AppError-vs-network-error split): onSave rejecting with an AppError
// (structure.invalid_layout_mode / structure.logic_variant_requires_logic_mode
// / 401) means the SERVER answered -> `error` state (Banner variant="error").
// onSave rejecting with a plain Error (fetch itself failed -- offline) means
// the write was accepted locally and will sync later (spec.md §6 NFR) ->
// `offline-queued` state (Banner variant="info").
//
// confirm-reset (AC-11b/AC-16b): switching layoutMode, or switching
// logicVariant while layoutMode stays 'logic', when the user already has
// cards arranged (`hasArrangedCards: true`) shows a ConfirmDialog BEFORE
// onSave is called -- cancelling must never call onSave and must leave the
// previously-saved choice selected.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeclarationScreen } from './DeclarationScreen';
import type { DeclarationScreenState } from './DeclarationScreen';

function baseState(overrides: Partial<DeclarationScreenState> = {}): DeclarationScreenState {
  return {
    declaration: 'Навчання й здоров’я зараз важливіші за кар’єру.',
    layoutMode: 'free',
    logicVariant: null,
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

test('empty: layoutMode null (AC-09) — жоден варіант розкладки не обраний, LogicVariantPicker не показаний', async () => {
  const props = baseProps({ declaration: null, layoutMode: null, logicVariant: null });
  render(<DeclarationScreen {...props} />);

  const textarea = await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  expect((textarea as HTMLTextAreaElement).value).toBe('');

  expect((screen.getByRole('radio', { name: 'Одна картка' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('radio', { name: 'Вільно' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('radio', { name: 'За логікою' }) as HTMLInputElement).checked).toBe(false);
  expect(screen.queryByRole('radio', { name: 'Баланс навколо ядра' })).toBeNull();
});

test('default: декларація й обраний режим завантажені та показані', async () => {
  const props = baseProps({ layoutMode: 'single' });
  render(<DeclarationScreen {...props} />);

  const textarea = await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  expect((textarea as HTMLTextAreaElement).value).toBe('Навчання й здоров’я зараз важливіші за кар’єру.');
  expect((screen.getByRole('radio', { name: 'Одна картка' }) as HTMLInputElement).checked).toBe(true);
});

test('AC-16: LogicVariantPicker показаний лише коли layoutMode = "logic"', async () => {
  const props = baseProps({ layoutMode: 'logic', logicVariant: 'balance' });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  expect(screen.getByRole('radio', { name: 'Баланс навколо ядра' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Фокус і спостереження' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Причина і наслідок' })).toBeTruthy();
  expect((screen.getByRole('radio', { name: 'Баланс навколо ядра' }) as HTMLInputElement).checked).toBe(true);
});

test('AC-16: перемикання на "За логікою" з іншого режиму показує LogicVariantPicker без збереженого підвиду', async () => {
  const props = baseProps({ layoutMode: 'free' });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  expect(screen.queryByRole('radio', { name: 'Баланс навколо ядра' })).toBeNull();

  fireEvent.click(screen.getByRole('radio', { name: 'За логікою' }));

  expect(screen.getByRole('radio', { name: 'Баланс навколо ядра' })).toBeTruthy();
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
  fireEvent.click(screen.getByRole('radio', { name: 'Одна картка' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() =>
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ layoutMode: 'single' })),
  );
});

test('AC-11b: зміна layoutMode з уже розкладеними картками показує ConfirmDialog ПЕРЕД onSave', async () => {
  const props = baseProps({ layoutMode: 'free', hasArrangedCards: true });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.click(screen.getByRole('radio', { name: 'Одна картка' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(props.onSave).not.toHaveBeenCalled();
});

test('AC-11b: підтвердження в ConfirmDialog викликає onSave з новим layoutMode', async () => {
  const props = baseProps({ layoutMode: 'free', hasArrangedCards: true });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.click(screen.getByRole('radio', { name: 'Одна картка' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Змінити' }));

  await waitFor(() =>
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ layoutMode: 'single' })),
  );
});

test('AC-11b: скасування в ConfirmDialog не викликає onSave і лишає попередній режим обраним', async () => {
  const props = baseProps({ layoutMode: 'free', hasArrangedCards: true });
  render(<DeclarationScreen {...props} />);

  await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.click(screen.getByRole('radio', { name: 'Одна картка' }));
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Скасувати' }));

  expect(props.onSave).not.toHaveBeenCalled();
  expect((screen.getByRole('radio', { name: 'Вільно' }) as HTMLInputElement).checked).toBe(true);
});

test('AC-16b: зміна підвиду "за логікою" з уже розкладеними картками теж проходить через ConfirmDialog', async () => {
  const props = baseProps({ layoutMode: 'logic', logicVariant: 'balance', hasArrangedCards: true });
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
  const onSave = vi.fn().mockRejectedValue(new FakeAppError('layoutMode must be one of: single, free, logic'));
  const props = { ...baseProps(), onSave };
  render(<DeclarationScreen {...props} />);

  const textarea = await screen.findByLabelText('Картина світу, навіщо, пріоритет');
  fireEvent.change(textarea, { target: { value: 'текст' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

  const banner = await screen.findByText('layoutMode must be one of: single, free, logic');
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
});
