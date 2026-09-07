import { fireEvent, render, screen } from '@testing-library/react';
import { CreateCardForm } from './CreateCardForm';

// AC-02 (spec.md §5) + screens.md SCR-04 -- усі 4 стани покриті трігером,
// не лише монтуванням: default / validation / saving / error.

test('default: порожнє поле назви, без помилки, кнопка "Створити" доступна', () => {
  render(<CreateCardForm onCreate={vi.fn()} />);

  const nameField = screen.getByLabelText('Назва') as HTMLInputElement;

  expect(nameField.value).toBe('');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Створити' })).toBeTruthy();
});

test('validation (AC-02): спроба зберегти без назви показує інлайн-помилку і не викликає onCreate', () => {
  const onCreate = vi.fn();
  render(<CreateCardForm onCreate={onCreate} />);

  fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

  expect(screen.getByRole('alert').textContent).toBe('Назва картки обовʼязкова');
  expect(onCreate).not.toHaveBeenCalled();
});

test('saving: збереження в процесі показує Spinner, поки onCreate не завершився', async () => {
  let resolveCreate: () => void = () => {};
  const onCreate = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveCreate = resolve;
      }),
  );

  render(<CreateCardForm onCreate={onCreate} />);
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт' } });
  fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

  expect(await screen.findByRole('status')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Створити' })).toBeNull();
  expect(onCreate).toHaveBeenCalledWith({ name: 'Спорт' });

  resolveCreate();
  expect(await screen.findByRole('button', { name: 'Створити' })).toBeTruthy();
});

test('cancel: коли передано onCancel, рендерить кнопку "Скасувати", яка викликає onCancel без onCreate', () => {
  const onCreate = vi.fn();
  const onCancel = vi.fn();
  render(<CreateCardForm onCreate={onCreate} onCancel={onCancel} />);

  fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onCreate).not.toHaveBeenCalled();
});

test('cancel: без onCancel кнопка "Скасувати" не рендериться', () => {
  render(<CreateCardForm onCreate={vi.fn()} />);

  expect(screen.queryByRole('button', { name: 'Скасувати' })).toBeNull();
});

// Review 2026-09-07 E (T52): "CreateCardForm підміняє реальне повідомлення
// сервера на загальне" -- раніше КОЖНЕ відхилення onCreate (незалежно від
// того, чи мало воно змістовний .message) показувало той самий узагальнений
// текст. Тепер -- як і решта форм цього застосунку (ArchiveCardDialog,
// MetricBlockCard, T49) -- реальний error.message, якщо він є.
test('error: відхилений onCreate з Error показує РЕАЛЬНЕ повідомлення сервера, не узагальнений текст', async () => {
  const onCreate = vi.fn().mockRejectedValue(new Error('Картка з такою назвою вже існує'));
  render(<CreateCardForm onCreate={onCreate} />);

  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт' } });
  fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

  const banner = await screen.findByText('Картка з такою назвою вже існує');

  expect(banner.getAttribute('data-variant')).toBe('error');
  expect(screen.getByRole('button', { name: 'Створити' })).toBeTruthy();
});

test('error: відхилення БЕЗ Error-інстанса (напр. рядок) падає на дефолтний текст', async () => {
  const onCreate = vi.fn().mockRejectedValue('network down');
  render(<CreateCardForm onCreate={onCreate} />);

  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт' } });
  fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

  const banner = await screen.findByText('Не вдалося зберегти картку. Перевірте зв’язок і спробуйте ще раз.');

  expect(banner.getAttribute('data-variant')).toBe('error');
});
