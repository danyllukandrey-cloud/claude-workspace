import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// D-112 (docs/DECISIONS.md): та сама хмаринка-підказка, що TextField.

test('D-112: фокус на порожньому (null) полі з hint показує хмаринку', () => {
  render(<NumberField label="Ціль" value={null} onChange={vi.fn()} hint="Наприклад: 12" />);

  fireEvent.focus(screen.getByLabelText('Ціль'));

  expect(screen.getByRole('tooltip').textContent).toContain('Наприклад: 12');
});

test('D-112: хмаринка зникає, щойно поле заповнено числом', () => {
  const { rerender } = render(<NumberField label="Ціль" value={null} onChange={vi.fn()} hint="Наприклад: 12" />);
  fireEvent.focus(screen.getByLabelText('Ціль'));
  expect(screen.getByRole('tooltip')).toBeTruthy();

  rerender(<NumberField label="Ціль" value={12} onChange={vi.fn()} hint="Наприклад: 12" />);

  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('D-112: клік "✕" закриває хмаринку без заповнення поля', () => {
  render(<NumberField label="Ціль" value={null} onChange={vi.fn()} hint="Наприклад: 12" />);
  fireEvent.focus(screen.getByLabelText('Ціль'));

  fireEvent.click(screen.getByRole('button', { name: /Закрити підказку/ }));

  expect(screen.queryByRole('tooltip')).toBeNull();
});

// Review 2026-09-07 E (RED, T52) -- той самий baг/фікс, що TextField.test.tsx:
// userEvent.click відтворює реальну послідовність mousedown->blur->click,
// яку fireEvent.click вище не ловить.

test('D-112 (review 2026-09-07 E): реальний клік "✕" (mousedown -> blur -> click) закриває хмаринку назавжди, не губиться в гонці', async () => {
  const user = userEvent.setup();
  render(<NumberField label="Ціль" value={null} onChange={vi.fn()} hint="Наприклад: 12" />);

  await user.click(screen.getByLabelText('Ціль'));
  expect(screen.getByRole('tooltip')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: /Закрити підказку/ }));

  expect(screen.queryByRole('tooltip')).toBeNull();

  await user.click(document.body);
  await user.click(screen.getByLabelText('Ціль'));
  expect(screen.queryByRole('tooltip')).toBeNull();
});
