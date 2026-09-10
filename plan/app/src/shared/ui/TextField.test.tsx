import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextField } from './TextField';

test('TextField викликає onChange з новим значенням при вводі', () => {
  const onChange = vi.fn();

  render(<TextField label="Назва" value="" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Спорт' } });

  expect(onChange).toHaveBeenCalledWith('Спорт');
});

test('TextField показує інлайн-помилку, коли передано error', () => {
  render(<TextField label="Назва" value="" onChange={vi.fn()} error="Назва обов'язкова" />);

  expect(screen.getByRole('alert').textContent).toBe("Назва обов'язкова");
});

test('TextField без error не рендерить блок помилки', () => {
  render(<TextField label="Назва" value="" onChange={vi.fn()} />);

  expect(screen.queryByRole('alert')).toBeNull();
});

// D-112 (docs/DECISIONS.md): хмаринка-підказка -- приклад + навіщо.

test('D-112: без hint-пропа хмаринка не рендериться навіть у фокусі на порожньому полі', () => {
  render(<TextField label="Назва" value="" onChange={vi.fn()} />);

  fireEvent.focus(screen.getByLabelText('Назва'));

  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('D-112: хмаринка не зʼявляється, поки в поле не зайшли', () => {
  render(<TextField label="Назва" value="" onChange={vi.fn()} hint="Наприклад: Спорт" />);

  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('D-112: фокус на порожньому полі з hint показує хмаринку з позначкою обовʼязковості та текстом', () => {
  render(<TextField label="Назва" value="" onChange={vi.fn()} hint="Наприклад: Спорт" required />);

  fireEvent.focus(screen.getByLabelText('Назва'));

  const tooltip = screen.getByRole('tooltip');
  expect(tooltip.textContent).toContain('Обовʼязково');
  expect(tooltip.textContent).toContain('Наприклад: Спорт');
});

test('D-112: необовʼязкове поле показує "Необовʼязково"', () => {
  render(<TextField label="Опис" value="" onChange={vi.fn()} hint="Наприклад: щось" />);

  fireEvent.focus(screen.getByLabelText('Опис'));

  expect(screen.getByRole('tooltip').textContent).toContain('Необовʼязково');
});

test('D-112: хмаринка зникає, щойно поле заповнено', () => {
  const { rerender } = render(<TextField label="Назва" value="" onChange={vi.fn()} hint="Наприклад: Спорт" />);
  fireEvent.focus(screen.getByLabelText('Назва'));
  expect(screen.getByRole('tooltip')).toBeTruthy();

  rerender(<TextField label="Назва" value="Спорт" onChange={vi.fn()} hint="Наприклад: Спорт" />);

  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('D-112: клік "✕" закриває хмаринку без заповнення поля', () => {
  render(<TextField label="Назва" value="" onChange={vi.fn()} hint="Наприклад: Спорт" />);
  fireEvent.focus(screen.getByLabelText('Назва'));
  expect(screen.getByRole('tooltip')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /Закрити підказку/ }));

  expect(screen.queryByRole('tooltip')).toBeNull();
});

// Review 2026-09-07 E (RED, docs/features/life-area-card/_review/review-2026-09-07.md,
// T52): "тултip «✕» не закривається через гонку blur/click (і тести це не
// ловлять — fireEvent.click не імітує blur)". userEvent.click (не fireEvent.click)
// відтворює РЕАЛЬНУ послідовність pointerdown -> mousedown -> (можлива зміна
// фокусу) -> mouseup -> click, з тими самими правилами focus-management, що
// jsdom реалізує для реальних браузерів -- САМЕ тому попередній тест вище
// (fireEvent.click) не ловив баг: onBlur інпута спрацьовував ПЕРШИМ (миша
// відводить фокус при mousedown), ховаючи/розмонтовуючи кнопку "✕" ДО того,
// як click міг спрацювати.

test('D-112 (review 2026-09-07 E): реальний клік "✕" (mousedown -> blur -> click) закриває хмаринку назавжди, не губиться в гонці', async () => {
  const user = userEvent.setup();
  render(<TextField label="Назва" value="" onChange={vi.fn()} hint="Наприклад: Спорт" />);

  await user.click(screen.getByLabelText('Назва'));
  expect(screen.getByRole('tooltip')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: /Закрити підказку/ }));

  expect(screen.queryByRole('tooltip')).toBeNull();

  // D-112: закрита хмаринка НЕ зʼявляється знову для цього монтування,
  // навіть якщо користувач вийде й зайде в порожнє поле повторно.
  await user.click(document.body);
  await user.click(screen.getByLabelText('Назва'));
  expect(screen.queryByRole('tooltip')).toBeNull();
});
