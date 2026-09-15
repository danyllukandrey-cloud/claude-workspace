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

// D-120 (оновлено): user/agent -- дві різні матові поверхні, БЕЗ фірмового
// кольору -- відрізняються не кольором, а тоном/насиченістю (user --
// приглушений ink-тінт, agent -- звичайна нейтральна поверхня), той самий
// принцип відмінності, що й раніше, лише без оранжевого.
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
//
// `whitespace-pre-line` (D-121, живе тестування -- заміна вітального тексту,
// onboarding-handler.ts): звичайний HTML/CSS за замовчуванням схлопує `\n`
// у пробіл -- багатоабзацний вітальний текст (порожні рядки між абзацами)
// без цього показав би однією суцільною лінією. Не `pre-wrap` -- зайві
// послідовні пробіли (якщо колись трапляться у вмісті) і далі схлопуються,
// зберігаються лише самі переноси рядків.
export function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  return (
    <div data-role={message.role} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          isUser
            ? 'w-[calc(100%-0.5rem)] whitespace-pre-line break-words rounded-control bg-ink/10 px-3.5 py-2.5 text-right text-sm text-ink'
            : 'w-[calc(100%-0.5rem)] whitespace-pre-line break-words rounded-control bg-surface-solid px-3.5 py-2.5 text-left text-sm text-ink shadow-soft'
        }
      >
        {message.content}
      </div>
    </div>
  );
}
