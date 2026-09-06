import { fireEvent, render, screen } from '@testing-library/react';
import { NumberField } from './NumberField';

test('NumberField викликає onChange з числом при вводі', () => {
  const onChange = vi.fn();

  render(<NumberField label="Ціль" value={null} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Ціль'), { target: { value: '12' } });

  expect(onChange).toHaveBeenCalledWith(12);
});

test('NumberField викликає onChange з null, коли поле спорожнено', () => {
  const onChange = vi.fn();

  render(<NumberField label="Ціль" value={12} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Ціль'), { target: { value: '' } });

  expect(onChange).toHaveBeenCalledWith(null);
});

test('NumberField показує інлайн-помилку, коли передано error', () => {
  render(<NumberField label="Ціль" value={null} onChange={vi.fn()} error="Ціль має бути більшою за нуль" />);

  expect(screen.getByRole('alert').textContent).toBe('Ціль має бути більшою за нуль');
});
