import { fireEvent, render, screen } from '@testing-library/react';
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
