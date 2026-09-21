// T20 — SCR-01 Декларація, screens.md: component test for DeclarationScreen
// -- default/empty/loading/edit/saved/offline-queued/error states
// (spec.md AC-09, AC-10).
//
// DI style (plan/app/CLAUDE.md, matches CardDetailScreen/LayoutBoardArchiveDialog):
// loadStructure/onSave are injected props, no fetch() inside the component.
//
// Живе тестування (Андрій): екран має ДВА стани -- VIEW (read-only текст,
// за замовчуванням) і EDIT (textarea, той самий, що був завжди). Перемикач
// -- одна плаваюча кнопка "Змінити декларацію" знизу по центру: у VIEW вона
// ВІДКРИВАЄ EDIT.
//
// CH-08 (docs/features/structure/changes.md): у EDIT та сама кнопка-позиція
// має ІНШИЙ підпис -- "Декларувати" (не "Змінити декларацію") -- і зберігає.
// Зліва від неї, лише в EDIT, з'являється "На зад" -- повертає на VIEW БЕЗ
// onSave і БЕЗ збереження чернетки (наступний startEdit знову показує
// останній ЗБЕРЕЖЕНИЙ текст). Заголовок textarea тепер "Опишіть Вашу
// картину світу, як і ким Ви себе відчуваєте, або який шлях вибрали"
// (був "Картина світу, навіщо, пріоритет"). LAYOUT_MODE_OPTIONS/
// ConfirmDialog (колишні AC-11/AC-11b тут) переїхали цілком на
// LayoutBoard.test.tsx -- цей файл їх більше не перевіряє.
//
// Save-failure discrimination (mirrors src/app/main.tsx's
// AppError-vs-network-error split): onSave rejecting with an AppError
// (структура.* / 401) means the SERVER answered -> `error` state (Banner
// variant="error"), екран ЛИШАЄТЬСЯ в EDIT (значення не збереглось). onSave
// rejecting with a plain Error (fetch itself failed -- offline) means the
// write was accepted locally and will sync later (spec.md §6 NFR) ->
// `offline-queued` state (Banner variant="info"), екран повертається на VIEW
// (той самий принцип, що спроба вважається прийнятою).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeclarationScreen } from './DeclarationScreen';
import type { DeclarationScreenState } from './DeclarationScreen';

const TEXTAREA_LABEL = 'Опишіть Вашу картину світу, як і ким Ви себе відчуваєте, або який шлях вибрали';

function baseState(overrides: Partial<DeclarationScreenState> = {}): DeclarationScreenState {
  return {
    declaration: 'Навчання й здоров’я зараз важливіші за кар’єру.',
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

test('empty (AC-09): декларація ще не написана -- VIEW показує курсивом "Тексту декларації поки немає", жодного textarea', async () => {
  const props = baseProps({ declaration: null });
  render(<DeclarationScreen {...props} />);

  const hint = await screen.findByText('Тексту декларації поки немає');
  expect(hint.className).toContain('italic');
  expect(screen.queryByLabelText(TEXTAREA_LABEL)).toBeNull();
  expect(await screen.findByRole('button', { name: 'Змінити декларацію' })).toBeTruthy();
});

test('default: VIEW показує вже збережений текст декларації read-only, без textarea', async () => {
  const props = baseProps();
  render(<DeclarationScreen {...props} />);

  expect(await screen.findByText('Навчання й здоров’я зараз важливіші за кар’єру.')).toBeTruthy();
  expect(screen.queryByLabelText(TEXTAREA_LABEL)).toBeNull();
});

test('CH-08: у VIEW немає "На зад" -- кнопка лише поруч зі збереженням в EDIT', async () => {
  const props = baseProps();
  render(<DeclarationScreen {...props} />);

  await screen.findByText('Навчання й здоров’я зараз важливіші за кар’єру.');
  expect(screen.queryByRole('button', { name: 'На зад' })).toBeNull();
});

test('живе тестування: клік "Змінити декларацію" у VIEW перемикає на EDIT -- textarea з поточним текстом, кнопка збереження стає "Декларувати", зʼявляється "На зад"', async () => {
  const props = baseProps();
  render(<DeclarationScreen {...props} />);

  await screen.findByText('Навчання й здоров’я зараз важливіші за кар’єру.');
  fireEvent.click(screen.getByRole('button', { name: 'Змінити декларацію' }));

  const textarea = await screen.findByLabelText(TEXTAREA_LABEL);
  expect((textarea as HTMLTextAreaElement).value).toBe('Навчання й здоров’я зараз важливіші за кар’єру.');
  // CH-08: у EDIT підпис кнопки збереження змінюється на "Декларувати" --
  // "Змінити декларацію" більше не рендериться взагалі.
  expect(screen.queryByRole('button', { name: 'Змінити декларацію' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Декларувати' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'На зад' })).toBeTruthy();
});

test('CH-08: "На зад" повертає на VIEW без onSave і відкидає чернетку -- наступний вхід в EDIT показує старий збережений текст', async () => {
  const props = baseProps();
  render(<DeclarationScreen {...props} />);

  await screen.findByText('Навчання й здоров’я зараз важливіші за кар’єру.');
  fireEvent.click(screen.getByRole('button', { name: 'Змінити декларацію' }));

  const textarea = await screen.findByLabelText(TEXTAREA_LABEL);
  fireEvent.change(textarea, { target: { value: 'недописана чернетка' } });
  fireEvent.click(screen.getByRole('button', { name: 'На зад' }));

  // Повернулись на VIEW зі старим текстом -- чернетка ніде не збереглась.
  expect(await screen.findByText('Навчання й здоров’я зараз важливіші за кар’єру.')).toBeTruthy();
  expect(screen.queryByText('недописана чернетка')).toBeNull();
  expect(props.onSave).not.toHaveBeenCalled();

  // Знову відкрили EDIT -- textarea показує останній ЗБЕРЕЖЕНИЙ текст, не чернетку.
  fireEvent.click(screen.getByRole('button', { name: 'Змінити декларацію' }));
  const textareaAgain = await screen.findByLabelText(TEXTAREA_LABEL);
  expect((textareaAgain as HTMLTextAreaElement).value).toBe('Навчання й здоров’я зараз важливіші за кар’єру.');
});

// code-review 2026-09-21 (correctness): без isSaving-гейту клік "На зад" ПІД
// ЧАС того, як onSave ще в польоті, перемикав екран на VIEW, а щойно
// збереження резолвилось -- persist() мовчки перезаписував текст чернеткою й
// показував "Збережено" на екрані, який користувач щойно "скасував". Обидві
// кнопки мають бути недоступні, поки збереження в польоті.
test('CH-08 review-fix: "На зад" і кнопка збереження заблоковані, поки onSave у польоті', async () => {
  let resolveSave: (() => void) | undefined;
  const onSave = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
  const props = { ...baseProps(), onSave };
  render(<DeclarationScreen {...props} />);

  await screen.findByText('Навчання й здоров’я зараз важливіші за кар’єру.');
  fireEvent.click(screen.getByRole('button', { name: 'Змінити декларацію' }));
  fireEvent.change(await screen.findByLabelText(TEXTAREA_LABEL), { target: { value: 'новий текст' } });
  fireEvent.click(screen.getByRole('button', { name: 'Декларувати' }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'На зад' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Декларувати' }).hasAttribute('disabled')).toBe(true);

  resolveSave?.();
  await screen.findByText('новий текст');
});

test('AC-10/CH-08: клік "Декларувати" в EDIT викликає onSave лише з declaration, показує Banner "saved" і повертає на VIEW', async () => {
  const props = baseProps();
  render(<DeclarationScreen {...props} />);

  await screen.findByText('Навчання й здоров’я зараз важливіші за кар’єру.');
  fireEvent.click(screen.getByRole('button', { name: 'Змінити декларацію' }));

  const textarea = await screen.findByLabelText(TEXTAREA_LABEL);
  fireEvent.change(textarea, { target: { value: 'нова декларація' } });
  fireEvent.click(screen.getByRole('button', { name: 'Декларувати' }));

  await screen.findByText('Збережено');
  expect(props.onSave).toHaveBeenCalledWith({ declaration: 'нова декларація' });
  // Жодного layoutMode -- той пропс на цьому екрані більше не існує.
  expect(props.onSave.mock.calls[0][0]).not.toHaveProperty('layoutMode');
  // Повернулись на VIEW -- textarea зникла, видно свіжий текст.
  await waitFor(() => expect(screen.queryByLabelText(TEXTAREA_LABEL)).toBeNull());
  expect(await screen.findByText('нова декларація')).toBeTruthy();
});

test('offline-queued: onSave, що падає зі звичайною мережевою помилкою (не AppError), показує Banner variant="info" і повертає на VIEW', async () => {
  const onSave = vi.fn().mockRejectedValue(new Error('network request failed'));
  const props = { ...baseProps(), onSave };
  render(<DeclarationScreen {...props} />);

  await screen.findByText('Навчання й здоров’я зараз важливіші за кар’єру.');
  fireEvent.click(screen.getByRole('button', { name: 'Змінити декларацію' }));
  const textarea = await screen.findByLabelText(TEXTAREA_LABEL);
  fireEvent.change(textarea, { target: { value: 'новий текст' } });
  fireEvent.click(screen.getByRole('button', { name: 'Декларувати' }));

  const banner = await screen.findByText(/офлайн|синхронізу/i);
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('info');
  await waitFor(() => expect(screen.queryByLabelText(TEXTAREA_LABEL)).toBeNull());
});

test('error: onSave, що падає з AppError, показує Banner variant="error" і ЛИШАЄ екран в EDIT', async () => {
  class FakeAppError extends Error {
    code = 'structure.request_failed';
    httpStatus = 500;
  }
  const onSave = vi.fn().mockRejectedValue(new FakeAppError('Не вдалося зберегти'));
  const props = { ...baseProps(), onSave };
  render(<DeclarationScreen {...props} />);

  await screen.findByText('Навчання й здоров’я зараз важливіші за кар’єру.');
  fireEvent.click(screen.getByRole('button', { name: 'Змінити декларацію' }));
  const textarea = await screen.findByLabelText(TEXTAREA_LABEL);
  fireEvent.change(textarea, { target: { value: 'текст' } });
  fireEvent.click(screen.getByRole('button', { name: 'Декларувати' }));

  const banner = await screen.findByText('Не вдалося зберегти');
  expect(banner.closest('[data-variant]')?.getAttribute('data-variant')).toBe('error');
  // Значення не збереглось -- textarea й досі тут, з тим самим текстом, і "На зад" досі доступний.
  expect(screen.getByLabelText(TEXTAREA_LABEL)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'На зад' })).toBeTruthy();
});
