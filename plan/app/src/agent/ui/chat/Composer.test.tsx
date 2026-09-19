import { render, screen, fireEvent } from '@testing-library/react';
import { Composer } from './Composer';

function makeFile(name = 'photo.png'): File {
  return new File(['fake-bytes'], name, { type: 'image/png' });
}

test('Composer надсилає лише текст, коли вкладення не додано (AC-01)', () => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} />);

  fireEvent.change(screen.getByLabelText('Повідомлення'), { target: { value: 'пробіг 5 км' } });
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith({ content: 'пробіг 5 км', attachment: null });
});

test('Composer надсилає лише вкладення, коли текст порожній (AC-10 -- вкладення замінює текстовий опис повністю)', () => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} />);

  const file = makeFile();
  fireEvent.change(screen.getByLabelText('Прикріпити фото'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith({ content: null, attachment: file });
});

test('Composer надсилає текст і вкладення разом, коли задано обидва', () => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} />);

  const file = makeFile('sторінка.jpg');
  fireEvent.change(screen.getByLabelText('Повідомлення'), { target: { value: 'сторінка книги' } });
  fireEvent.change(screen.getByLabelText('Прикріпити фото'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith({ content: 'сторінка книги', attachment: file });
});

test('Composer не дозволяє надіслати порожнє повідомлення без тексту і без вкладення', () => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} />);

  expect(screen.getByRole('button', { name: 'Надіслати' }).hasAttribute('disabled')).toBe(true);
  expect(onSend).not.toHaveBeenCalled();
});

test('Composer надсилає повідомлення при сабміті форми (D-121, живе тестування -- Enter у реальному браузері) -- не лише при кліку', () => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} />);

  const input = screen.getByLabelText('Повідомлення');
  fireEvent.change(input, { target: { value: 'пробіг 5 км' } });
  // jsdom не реалізує неявний сабміт форми по Enter (браузерна дефолтна
  // поведінка) -- перевіряємо сам механізм, на якому вона тримається: рядок
  // значків -- справжній <form>, submit має викликати onSend так само, як клік.
  fireEvent.submit(input.closest('form')!);

  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith({ content: 'пробіг 5 км', attachment: null });
});

test('Composer очищує поля після успішного надсилання', () => {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} />);

  fireEvent.change(screen.getByLabelText('Повідомлення'), { target: { value: 'пробіг 5 км' } });
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));

  expect((screen.getByLabelText('Повідомлення') as HTMLInputElement).value).toBe('');
});
