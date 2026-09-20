// T10 -- компонентний тест редактора одного пункту плану (spec.md AC-01/AC-02/AC-04).
//
// DI-стиль той самий, що PlanScreen.test.tsx/DeclarationScreen.test.tsx:
// onCreate/onUpdate/onDelete/onClose -- ін'єктовані пропи-функції, жодного
// fetch() у самому компоненті.
//
// Що саме фіксують тести:
// - AC-01: новий пункт із непорожнім текстом -> onCreate(horizon, planText).
// - AC-02: новий пункт із порожнім (чи лише-пробільним) текстом -> пояснення
//   на місці й ЖОДНОГО запиту -- правило "потрібен текст" діє тільки на створення.
// - AC-04: очищення тексту НАЯВНОГО пункту й збереження -> onDelete, а не
//   onUpdate (за контрактом порожній planText у PATCH -- це 422, не видалення).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanItemEditor } from './PlanItemEditor';
import type { PlanScreenItem } from './PlanScreen';

function existingItem(): PlanScreenItem {
  return {
    id: 'i1',
    horizon: 'tactical',
    planText: 'Пробігти 5 км без зупинки',
    done: false,
    createdAt: '2026-09-18T08:00:00.000Z',
  };
}

function baseProps() {
  return {
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
  };
}

function field(): HTMLInputElement {
  return screen.getByLabelText('Текст пункту') as HTMLInputElement;
}

function save(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
}

test('AC-01: новий пункт -- поле порожнє, збереження з текстом викликає onCreate саме для цього горизонту', async () => {
  const props = baseProps();
  render(<PlanItemEditor target={{ kind: 'new', horizon: 'strategic' }} {...props} />);

  expect(field().value).toBe('');

  fireEvent.change(field(), { target: { value: 'Побудувати дім' } });
  save();

  await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
  expect(props.onCreate).toHaveBeenCalledWith({ horizon: 'strategic', planText: 'Побудувати дім' });
  expect(props.onUpdate).not.toHaveBeenCalled();
  expect(props.onDelete).not.toHaveBeenCalled();
  // Успішне збереження закриває редактор -- користувач повертається на ПЛАН.
  await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
});

test('AC-02: новий пункт із порожнім текстом -- пояснення на місці, жодного запиту', async () => {
  const props = baseProps();
  render(<PlanItemEditor target={{ kind: 'new', horizon: 'tactical' }} {...props} />);

  save();

  expect(screen.getByRole('alert').textContent).toMatch(/текст/i);
  expect(props.onCreate).not.toHaveBeenCalled();
  expect(props.onDelete).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
});

test('AC-02: новий пункт лише з пробілів -- те саме правило, запиту немає', async () => {
  const props = baseProps();
  render(<PlanItemEditor target={{ kind: 'new', horizon: 'tactical' }} {...props} />);

  fireEvent.change(field(), { target: { value: '   ' } });
  save();

  expect(screen.getByRole('alert')).toBeTruthy();
  expect(props.onCreate).not.toHaveBeenCalled();
});

test('AC-04: наявний пункт відкривається зі своїм текстом', () => {
  const props = baseProps();
  render(<PlanItemEditor target={{ kind: 'existing', item: existingItem() }} {...props} />);

  expect(field().value).toBe('Пробігти 5 км без зупинки');
});

test('AC-04: очищення тексту наявного пункту й збереження викликає onDelete, а не onUpdate', async () => {
  const props = baseProps();
  const item = existingItem();
  render(<PlanItemEditor target={{ kind: 'existing', item }} {...props} />);

  fireEvent.change(field(), { target: { value: '' } });
  save();

  await waitFor(() => expect(props.onDelete).toHaveBeenCalledTimes(1));
  expect(props.onDelete).toHaveBeenCalledWith(item);
  expect(props.onUpdate).not.toHaveBeenCalled();
  // Правило "потрібен текст" (AC-02) на редагування НЕ поширюється -- жест
  // очищення не має блокуватись поясненням.
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
});

test('AC-04: зміна тексту наявного пункту на інший непорожній викликає onUpdate', async () => {
  const props = baseProps();
  const item = existingItem();
  render(<PlanItemEditor target={{ kind: 'existing', item }} {...props} />);

  fireEvent.change(field(), { target: { value: 'Пробігти 10 км без зупинки' } });
  save();

  await waitFor(() => expect(props.onUpdate).toHaveBeenCalledTimes(1));
  expect(props.onUpdate).toHaveBeenCalledWith(item, 'Пробігти 10 км без зупинки');
  expect(props.onDelete).not.toHaveBeenCalled();
  expect(props.onCreate).not.toHaveBeenCalled();
});

test('збій збереження: показує помилку і лишає користувача в редакторі', async () => {
  const props = baseProps();
  props.onCreate = vi.fn().mockRejectedValue(new Error('Мережа недоступна'));
  render(<PlanItemEditor target={{ kind: 'new', horizon: 'tactical' }} {...props} />);

  fireEvent.change(field(), { target: { value: 'Побудувати дім' } });
  save();

  await waitFor(() => expect(screen.getByText(/Мережа недоступна/)).toBeTruthy());
  expect(props.onClose).not.toHaveBeenCalled();
  expect(field().value).toBe('Побудувати дім');
});
