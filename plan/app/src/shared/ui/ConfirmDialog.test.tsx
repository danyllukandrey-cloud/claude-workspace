import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

// AC (T24 DoD, п.5): "Component test: ConfirmDialog рендерить своє
// повідомлення і дві кнопки дій, обидва callback реально викликаються при
// кліку (userEvent чи fireEvent з @testing-library)".
test('ConfirmDialog рендерить повідомлення і дві кнопки, обидва callback викликаються при кліку', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  render(
    <ConfirmDialog
      message="Видалити картку «Спорт»?"
      confirmLabel="Видалити"
      cancelLabel="Скасувати"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );

  expect(screen.getByText('Видалити картку «Спорт»?')).toBeTruthy();

  const confirmButton = screen.getByRole('button', { name: 'Видалити' });
  const cancelButton = screen.getByRole('button', { name: 'Скасувати' });

  fireEvent.click(confirmButton);
  fireEvent.click(cancelButton);

  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

// Review 2026-09-07 E (RED, docs/features/life-area-card/_review/review-2026-09-07.md,
// T52): "ConfirmDialog без доступності (role/focus/Escape) і без захисту від
// подвійного сабміту при архівації".

function baseProps() {
  return {
    message: 'Видалити картку «Спорт»?',
    confirmLabel: 'Видалити',
    cancelLabel: 'Скасувати',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };
}

test('role=dialog + aria-modal -- допоміжні технології впізнають це як модальне вікно', () => {
  render(<ConfirmDialog {...baseProps()} />);

  const dialog = screen.getByRole('dialog');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
});

test('початковий фокус -- на кнопці "Скасувати" (безпечний дефолт для деструктивної дії, Enter одразу після відкриття не підтверджує)', () => {
  render(<ConfirmDialog {...baseProps()} />);

  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Скасувати' }));
});

test('Escape закриває діалог через onCancel, onConfirm НЕ викликається', () => {
  const props = baseProps();
  render(<ConfirmDialog {...props} />);

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

  expect(props.onCancel).toHaveBeenCalledTimes(1);
  expect(props.onConfirm).not.toHaveBeenCalled();
});

test('інша клавіша (не Escape) не викликає onCancel', () => {
  const props = baseProps();
  render(<ConfirmDialog {...props} />);

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

  expect(props.onCancel).not.toHaveBeenCalled();
});

test('confirmDisabled: кнопка підтвердження вимкнена і клік по ній не викликає onConfirm (захист від подвійного сабміту)', () => {
  const props = baseProps();
  render(<ConfirmDialog {...props} confirmDisabled />);

  const confirmButton = screen.getByRole('button', { name: 'Видалити' });
  expect(confirmButton.hasAttribute('disabled')).toBe(true);

  fireEvent.click(confirmButton);

  expect(props.onConfirm).not.toHaveBeenCalled();
});
