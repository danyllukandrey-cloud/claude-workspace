// Одне повідомлення чату SCR-01 (T25) -- роль user/agent (screens.md SCR-01,
// wireframe "Ти: .../Агент: ..."). `data-role` -- єдиний спосіб тесту
// розрізнити бульбашку користувача від бульбашки агента, той самий підхід,
// що вже `Banner`'s `data-variant` (shared/ui/Banner.tsx).
//
// Правило залежностей (plan/app/CLAUDE.md): чистий presentation-примітив,
// без domain/ports -- жодних імпортів поза React.

import type { ChatMessage } from './types';

export interface MessageBubbleProps {
  message: ChatMessage;
}

// D-120: user/agent -- дві різні матові поверхні, не фірмовий колір і
// нейтраль впереміш -- user (акцентний тінт, праворуч) відрізняється від
// agent (суцільна нейтральна поверхня, ліворуч) з першого погляду.
export function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  return (
    <div data-role={message.role} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-control bg-accent-soft px-3.5 py-2.5 text-sm text-ink'
            : 'max-w-[85%] rounded-control bg-surface-solid px-3.5 py-2.5 text-sm text-ink shadow-soft'
        }
      >
        {message.content}
      </div>
    </div>
  );
}
