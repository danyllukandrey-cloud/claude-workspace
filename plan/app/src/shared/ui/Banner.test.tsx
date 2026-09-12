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

// T19 (structure): design-system.md реєструє для Banner три declared states —
// success, error, info. Попередній тест вище перевіряв лише "error"; тут
// закриваємо прогалину для двох інших, щоб DoD T19 ("кожен примітив
// рендерить кожен заявлений стан") був підтверджений тестом, а не лише
// записом в інвентарі.
test.each([
  ['success', 'Збережено'],
  ['info', 'Синхронізація триває офлайн'],
] as const)('Banner рендерить variant="%s"', (variant, text) => {
  render(<Banner variant={variant} text={text} />);

  const banner = screen.getByText(text);

  expect(banner).toBeTruthy();
  expect(banner.getAttribute('data-variant')).toBe(variant);
});
