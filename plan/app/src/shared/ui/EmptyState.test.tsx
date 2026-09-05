import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

// AC (T24 DoD, п.4): "Component test: EmptyState рендерить переданий текст".
test('EmptyState рендерить переданий текст', () => {
  render(
    <EmptyState
      message="Ще немає жодної картки"
      actionHint="Натисніть «+», щоб створити першу"
    />,
  );

  expect(screen.getByText('Ще немає жодної картки')).toBeTruthy();
  expect(screen.getByText('Натисніть «+», щоб створити першу')).toBeTruthy();
});
