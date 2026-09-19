import { render, screen } from '@testing-library/react';
import { Logo } from './Logo';

test('Logo рендериться як доступне зображення з підписом', () => {
  render(<Logo />);

  expect(screen.getByRole('img', { name: 'ПЛАН — кубик Рубика' })).toBeTruthy();
});
