import { render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';

test('MessageBubble рендерить текст і роль повідомлення користувача', () => {
  render(
    <MessageBubble
      message={{ id: 'm-1', role: 'user', content: 'пробіг 5 км', createdAt: '2026-09-12T10:00:00Z' }}
    />,
  );

  const bubble = screen.getByText('пробіг 5 км');
  expect(bubble).toBeTruthy();
  expect(bubble.closest('[data-role]')?.getAttribute('data-role')).toBe('user');
});

test('MessageBubble рендерить роль agent окремо від user (AC-01 happy path -- відповідь агента)', () => {
  render(
    <MessageBubble
      message={{
        id: 'm-2',
        role: 'agent',
        content: 'записати в картку "Спорт", 5 км?',
        createdAt: '2026-09-12T10:00:01Z',
      }}
    />,
  );

  const bubble = screen.getByText('записати в картку "Спорт", 5 км?');
  expect(bubble.closest('[data-role]')?.getAttribute('data-role')).toBe('agent');
});
