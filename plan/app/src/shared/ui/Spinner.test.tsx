import { render, screen } from '@testing-library/react';
import { Spinner } from './Spinner';

// AC (T24 DoD, п.2): "Component test: Spinner рендериться (просто показує,
// що він на екрані -- знайти його роль/текст)".
test('Spinner рендериться на екрані', () => {
  render(<Spinner />);

  const spinner = screen.getByRole('status');

  expect(spinner).toBeTruthy();
});
