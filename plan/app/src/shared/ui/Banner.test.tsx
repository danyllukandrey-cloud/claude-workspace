import { render, screen } from '@testing-library/react';
import { Banner } from './Banner';

// AC (T24 DoD, п.3): "Component test: Banner рендерить свій text і variant
// (напр. через клас чи data-атрибут -- аби тест міг перевірити, який саме
// variant показано)".
test('Banner рендерить текст і variant', () => {
  render(<Banner variant="error" text="Щось пішло не так" />);

  const banner = screen.getByText('Щось пішло не так');

  expect(banner).toBeTruthy();
  expect(banner.getAttribute('data-variant')).toBe('error');
});
