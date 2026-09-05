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
