import { render, screen } from '@testing-library/react';
import { CardShell } from './CardShell';

// AC (T24 DoD, п.1): "Component test: CardShell перегортає між переданим
// лицьовим і зворотним вмістом (зміна пропу isFlipped -> видно інший вміст,
// попередній зникає)".
test('CardShell перегортає між лицьовим і зворотним вмістом при зміні isFlipped', () => {
  const { rerender } = render(
    <CardShell
      front={<div>Лицьовий вміст</div>}
      back={<div>Зворотний вміст</div>}
      isFlipped={false}
    />,
  );

  expect(screen.getByText('Лицьовий вміст')).toBeTruthy();
  expect(screen.queryByText('Зворотний вміст')).toBeNull();

  rerender(
    <CardShell
      front={<div>Лицьовий вміст</div>}
      back={<div>Зворотний вміст</div>}
      isFlipped={true}
    />,
  );

  expect(screen.getByText('Зворотний вміст')).toBeTruthy();
  expect(screen.queryByText('Лицьовий вміст')).toBeNull();
});
