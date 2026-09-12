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

export function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  return <div data-role={message.role}>{message.content}</div>;
}
