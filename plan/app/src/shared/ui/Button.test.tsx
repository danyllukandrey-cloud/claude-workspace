import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from './Button';

test('Button викликає onClick при кліку', () => {
  const onClick = vi.fn();

  render(<Button label="Створити" onClick={onClick} />);
  fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

  expect(onClick).toHaveBeenCalledTimes(1);
});

test('Button з disabled не викликає onClick при кліку', () => {
  const onClick = vi.fn();

  render(<Button label="Створити" onClick={onClick} disabled />);
  fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

  expect(onClick).not.toHaveBeenCalled();
});
