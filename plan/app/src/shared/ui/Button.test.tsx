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

// CH-02 (docs/app-shell.md): перша спроба додавала "bg-border" ПОВЕРХ
// фіксованого "bg-surface" через className -- обидва класи однакової
// специфічності в зібраній Tailwind-таблиці стилів, тож колір мовчки не
// мінявся (живе тестування виявило). `active` має РІВНО один із двох класів
// одночасно -- перевіряємо явно, щоб регресія на "додавання поверх" більше
// не пройшла непоміченою.
test('Button з active=true має bg-border і НЕ має bg-surface', () => {
  render(<Button label="Картки" active />);
  // Розбиваємо на окремі класи -- інакше "bg-border" зловив би сам себе
  // всередині "enabled:hover:bg-border" (інший клас, той самий "хвіст").
  const classes = screen.getByRole('button', { name: 'Картки' }).className.split(/\s+/);

  expect(classes).toContain('bg-border');
  expect(classes).not.toContain('bg-surface');
});

test('Button без active (за замовчуванням) має bg-surface і НЕ має bg-border', () => {
  render(<Button label="Картки" />);
  const classes = screen.getByRole('button', { name: 'Картки' }).className.split(/\s+/);

  expect(classes).toContain('bg-surface');
  expect(classes).not.toContain('bg-border');
});
