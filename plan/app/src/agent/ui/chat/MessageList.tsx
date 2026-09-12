// Прокручуваний список повідомлень SCR-01 (T25) -- default/empty-onboarding
// стани (screens.md SCR-01): порожня історія до першого повідомлення, чи
// заповнена бульбашками MessageBubble у порядку надходження. Прокрутку й
// віртуалізацію свідомо не додаємо в v1 -- обсяг повідомлень одного
// користувача не виправдовує складність (той самий default репозиторію,
// що "без кешу" в sad.md §4).
//
// Правило залежностей (plan/app/CLAUDE.md): ui -> ui цього ж модуля
// (MessageBubble), нічого з domain/ports.

import type { ChatMessage } from './types';
import { MessageBubble } from './MessageBubble';

export interface MessageListProps {
  /** Історія повідомлень у порядку показу (найстаріше -> найновіше). Порожній масив -- empty-onboarding (AC-13), відповідальність виклику. */
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps): JSX.Element {
  return (
    <div role="log">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
}
