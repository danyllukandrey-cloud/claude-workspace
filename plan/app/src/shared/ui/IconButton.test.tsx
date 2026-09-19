import { fireEvent, render, screen } from '@testing-library/react';
import { IconButton } from './IconButton';
import { SendIcon } from './icons';

test('IconButton викликає onClick при кліку, accessible name -- лише з label (іконка aria-hidden)', () => {
  const onClick = vi.fn();

  render(
    <IconButton label="Надіслати" onClick={onClick}>
      <SendIcon />
    </IconButton>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

  expect(onClick).toHaveBeenCalledTimes(1);
});

test('IconButton з disabled не викликає onClick при кліку', () => {
  const onClick = vi.fn();

  render(
    <IconButton label="Диктування (скоро)" onClick={onClick} disabled>
      <SendIcon />
    </IconButton>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Диктування (скоро)' }));

  expect(onClick).not.toHaveBeenCalled();
});
