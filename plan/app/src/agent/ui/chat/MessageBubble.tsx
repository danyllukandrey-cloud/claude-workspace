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
// нейтраль впереміш -- відрізняються кольором (user -- акцентний тінт, agent
// -- нейтральна поверхня), той самий підхід, що й раніше.
//
// D-121 (широкий екран, живе тестування -- двічі уточнено): перший прохід
// прибрав позиційний зсув повністю (`w-full`, ніякого iMessage-стилю) -- у
// вузькій 20%-колонці великий зсув (`max-w-[85%]`, до ~15% порожнечі з
// одного боку) робив бульбашки непропорційними. Другий прохід повернув
// зсув, але НЕВЕЛИКИЙ -- `calc(100%-0.5rem)` (0.5rem ~ ширина однієї букви
// тексту), не 85%: бульбашка й далі займає майже всю ширину, лише невеликий
// проміжок з протилежного від ролі боку (`justify-end`+відступ справа для
// user, `justify-start`+відступ зліва для agent) підказує напрямок.
// Вирівнювання ТЕКСТУ всередині (`text-right`/`text-left`) -- окрема вісь
// від позиції самої бульбашки, обидві тепер узгоджені з роллю.
export function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  return (
    <div data-role={message.role} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          isUser
            ? 'w-[calc(100%-0.5rem)] break-words rounded-control bg-accent-soft px-3.5 py-2.5 text-right text-sm text-ink'
            : 'w-[calc(100%-0.5rem)] break-words rounded-control bg-surface-solid px-3.5 py-2.5 text-left text-sm text-ink shadow-soft'
        }
      >
        {message.content}
      </div>
    </div>
  );
}
