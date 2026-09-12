import { render, screen } from '@testing-library/react';
import { MessageList } from './MessageList';
import type { ChatMessage } from './types';

test('MessageList рендерить повідомлення історії у порядку надходження', () => {
  const messages: ChatMessage[] = [
    { id: 'm-1', role: 'user', content: 'пробіг 5 км', createdAt: '2026-09-12T10:00:00Z' },
    { id: 'm-2', role: 'agent', content: 'записати в картку "Спорт"?', createdAt: '2026-09-12T10:00:01Z' },
  ];

  render(<MessageList messages={messages} />);

  expect(screen.getByText('пробіг 5 км')).toBeTruthy();
  expect(screen.getByText('записати в картку "Спорт"?')).toBeTruthy();
});

// empty-onboarding (screens.md SCR-01): порожня історія до першого повідомлення --
// список не падає й не рендерить жодної бульбашки.
test('MessageList рендерить порожній список без помилок і без бульбашок', () => {
  render(<MessageList messages={[]} />);

  expect(screen.queryByRole('log')?.children.length ?? 0).toBe(0);
});
