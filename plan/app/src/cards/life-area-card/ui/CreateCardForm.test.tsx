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

test('error: відхилений onCreate (мережа/401) показує Banner з поясненням', async () => {
  const onCreate = vi.fn().mockRejectedValue(new Error('network down'));
  render(<CreateCardForm onCreate={onCreate} />);

  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт' } });
  fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

  const banner = await screen.findByText('Не вдалося зберегти картку. Перевірте зв’язок і спробуйте ще раз.');

  expect(banner.getAttribute('data-variant')).toBe('error');
  expect(screen.getByRole('button', { name: 'Створити' })).toBeTruthy();
});
