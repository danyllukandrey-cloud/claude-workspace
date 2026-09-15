// Чат-панель (D-121, docs/app-shell.md) -- ДО D-121 це був повноекранний
// напрямок "SCR-01 Чат" (screens.md), файл звався ChatScreen.tsx. Тепер це
// постійний віджет, прикріплений унизу застосунку на ВСІХ напрямках без
// винятку (App.tsx рендерить його поза перемикачем `direction`) -- 9 станів
// нижче (tasks.json T26 DoD) лишились тими самими, змінився лише контейнер
// навколо них.
//
// spec.md AC-01/02/02b/03/04/05/09/10/10b/13/15. Стани: default /
// empty-onboarding / loading / proposal-pending / confirmed / clarifying /
// attachment-error / rate-limited / llm-unavailable / confirmed-hint (T47).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що RuleSettingsScreen.tsx, T27):
// loadHistory/loadOnboarding/loadActiveProposal/sendMessage/confirmProposal
// -- ін'єктовані функції, жодного fetch() тут. Реальний HTTP-транспорт --
// ports/chat-handler.ts (T20) + ports/proposal-handler.ts (T21), обидва вже
// реалізовані; підключає composition root (main.tsx).
//
// "Ти:"/"Агент:" з wireframe -- MessageBubble/MessageList (T25) уже
// візуалізують роль через data-role, текстовий префікс не додаємо тут
// повторно (той самий підхід, що вже усталений у T25).
//
// clarifying (AC-04/AC-05) -- НЕ окремий код-шлях: це просто default-рендер,
// де останнє повідомлення агента -- запитання, не пропозиція (відрізняється
// лише ЗМІСТОМ останнього повідомлення, не структурою) -- немає окремої
// гілки нижче, лише той факт, що ProposalCard не рендериться, коли
// activeProposal === null.
//
// confirmed-hint (AC-16/AC-16b, T47) -- дисмісибл-підказка над Composer
// одразу після завершеної дії (AC-16 приклад: підтвердження запису, AC-02).
// Статичний текст інтерфейсу, НЕ репліка агента (AC-16 explicitly, D-43) --
// HintBubble (T47) рендериться тут, ChatPanel сам вирішує коли showHint
// true/false, бо саме тут відомо про "завершену дію" (confirmProposal) і
// про фокус Composer (AC-16b, друга причина дисмісу).
//
// "confirmed" (AC-02) -- MessageTurn/ProposalConfirm (T20/T21) не повертають
// нове chat_message з текстом підтвердження (лише оновлений Proposal) --
// той підпис "Агент: записано ✓ ..." (колишній wireframe SCR-01) синтезується
// локально цим екраном одразу після успішного confirmProposal, той самий
// підхід, що MetricBlockCard раніше синтезував локальний фідбек до
// реального round-trip.
//
// "Уточнити" (ProposalCard.onRefine) -- навмисно без API-виклику: наступне
// звичайне повідомлення в Composer саме оновлює активну пропозицію
// (AC-02b, sad.md §4), тому клік лише знімає фокус на композер -- сам факт
// "хочу уточнити" не потребує окремого запиту.
//
// Розгортання/згортання (D-121): локальний UI-стан, не потребує пропу
// ззовні (панель монтується рівно раз, в App.tsx) -- CSS max-height/overflow,
// НЕ умовний unmount: історія/пропозиція вже завантажені у фоні незалежно
// від того, розгорнута панель чи ні (докстрінг App.tsx), тож розгортання
// ніколи не показує порожній стан там, де вже є дані.
//
// Уточнено живим тестуванням (D-121, три проходи):
// 1) переписка більше НЕ ховається через max-h-0/unmount, коли згорнуто --
//    дістається скролом замість зникнення в нікуди;
// 2) (проміжний варіант, СКАСОВАНО 3-м проходом) переписка й композер як
//    ОДИН спільний прокручуваний контейнер -- виявилось незручно: скрол
//    переписки рухав і композер геть з поля зору;
// 3) (чинний варіант) переписка й композер -- ДВА ОКРЕМІ блоки. Переписка
//    (scrollRef нижче) прокручується сама по собі, автоскрол донизу показує
//    останнє повідомлення за замовчуванням. Композер -- звичайний, НЕ
//    прокручуваний елемент під нею, завжди своєї природної висоти
//    (shrink-0) -- скрол переписки більше не чіпає композер.
// Висота ВЕРХНЬОГО блоку (переписки) лишається єдиною різницею між станами
// (0 <-> 30vh на мобільному; на md+ -- уся решта висоти стовпчика понад
// композер, хендл розгортання прихований).

import { useEffect, useRef, useState } from 'react';
import { Banner, ChevronIcon, Spinner } from '../../shared/ui';
import type { BannerVariant } from '../../shared/ui';
import { MessageList } from './chat/MessageList';
import { ProposalCard } from './chat/ProposalCard';
import { Composer } from './chat/Composer';
import type { ComposerSendInput } from './chat/Composer';
import { HintBubble } from './chat/HintBubble';
import type { ChatMessage, ChatProposal } from './chat/types';

// AC-16: точний текст статичної підказки -- один рядок джерела правди,
// однаковий і для рендеру, і для тесту.
export const CONFIRMED_HINT_TEXT =
  'Звертайся до Агента щоразу, коли маєш запитання чи не розумієш наступний крок';

export interface SendMessageResult {
  /** Текст відповіді агента (MessageTurn.reply, contracts/openapi.yaml) -- НЕ повний ChatMessage, лише рядок. */
  reply: string;
  proposal: ChatProposal | null;
}

export interface OnboardingResult {
  welcomeShown: boolean;
  /** Вітальне повідомлення -- лише якщо САМЕ цей виклик його щойно створив (AC-13), інакше NULL. */
  message: ChatMessage | null;
}

export interface ChatPanelProps {
  /** GET /messages -- повна історія (T20). Порожній масив -- нормально для першого візиту (AC-13). */
  loadHistory: () => Promise<ChatMessage[]>;
  /** GET /onboarding -- вітальне повідомлення на перший виклик (T24, AC-13). */
  loadOnboarding: () => Promise<OnboardingResult>;
  /** GET /proposals/active -- чи є пропозиція, що чекає підтвердження (T21). */
  loadActiveProposal: () => Promise<ChatProposal | null>;
  /** POST /messages -- одне повідомлення/вкладення (T20, AC-01/AC-10/AC-19). Кидає AppError-подібну помилку на 422/429/503. */
  sendMessage: (input: ComposerSendInput) => Promise<SendMessageResult>;
  /** POST /proposals/{id}/confirm (T21, AC-02). */
  confirmProposal: (proposalId: string) => Promise<void>;
}

interface AppErrorShape {
  message: string;
  code: unknown;
}

// Duck-typing замість `instanceof AppError` -- той самий підхід, що
// LayoutBoard.tsx/DeclarationScreen.tsx/RuleSettingsScreen.tsx.
function isAppErrorShape(error: unknown): error is AppErrorShape {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

interface BannerState {
  variant: BannerVariant;
  text: string;
}

const SEND_FAILURE_MESSAGE = 'Не вдалося надіслати повідомлення';

let localIdCounter = 0;
/** Ід для локально-синтезованих бульбашок (agent reply text, confirm-фідбек) -- MessageTurn не повертає id. */
function nextLocalId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}-local-${localIdCounter}`;
}

export function ChatPanel({
  loadHistory,
  loadOnboarding,
  loadActiveProposal,
  sendMessage,
  confirmProposal,
}: ChatPanelProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeProposal, setActiveProposal] = useState<ChatProposal | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showHint, setShowHint] = useState(false);
  // D-121: типовий стан при вході -- згорнута (один рядок композера), щоб
  // панель не забирала простір контентної зони на кожному екрані, поки
  // користувач сам не попросить переписку.
  const [expanded, setExpanded] = useState(false);
  // D-121 (живе тестування): прокручуваний контейнер переписки (композер --
  // окремий, не прокручуваний елемент нижче) -- автоскрол донизу показує
  // останнє повідомлення за замовчуванням.
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadHistory(), loadOnboarding(), loadActiveProposal()]).then(([history, onboarding, proposal]) => {
      if (cancelled) return;
      // AC-13: перший-візит-без-історії -- вітання в переписці; історія вже містить
      // це саме повідомлення на всіх наступних заходах (onboarding.message === null тоді).
      const initial = history.length === 0 && onboarding.message !== null ? [onboarding.message] : history;
      setMessages(initial);
      setActiveProposal(proposal);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // Ін'єктовані функції лишаються стабільними для життя панелі (той самий
    // підхід, що DeclarationScreen/RuleSettingsScreen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // D-121 (живе тестування): автоскрол донизу при кожній зміні вмісту чи
  // стану -- останнє повідомлення лишається видимим за замовчуванням, старіші
  // дістаються скролом угору. Без цього ефекту переписка показала б довільну
  // (браузерну дефолтну, найчастіше верхню) точку скролу замість останнього.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, activeProposal, showHint, banner, expanded, loading]);

  const handleSend = (input: ComposerSendInput): void => {
    if (sending) return;
    setBanner(null);
    setSending(true);

    // Оптимістичне відображення власного повідомлення (AC-01/AC-10) --
    // MessageCreate/MessageTurn не повертають ані нове user-повідомлення,
    // ані його id, лише reply агента (contracts/openapi.yaml).
    const ownMessage: ChatMessage = {
      id: nextLocalId('user'),
      role: 'user',
      content: input.content ?? (input.attachment ? `[вкладення: ${input.attachment.name}]` : ''),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, ownMessage]);

    sendMessage(input)
      .then((result) => {
        const replyMessage: ChatMessage = {
          id: nextLocalId('agent'),
          role: 'agent',
          content: result.reply,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, replyMessage]);
        setActiveProposal(result.proposal);
      })
      .catch((error: unknown) => {
        if (isAppErrorShape(error)) {
          setBanner({ variant: 'error', text: error.message });
        } else {
          const message = error instanceof Error ? error.message : SEND_FAILURE_MESSAGE;
          setBanner({ variant: 'error', text: message });
        }
      })
      .finally(() => setSending(false));
  };

  const handleConfirm = (): void => {
    if (!activeProposal || confirming) return;
    const confirmed = activeProposal;
    setConfirming(true);

    confirmProposal(confirmed.id)
      .then(() => {
        setActiveProposal(null);
        const confirmationMessage: ChatMessage = {
          id: nextLocalId('agent'),
          role: 'agent',
          content: `записано ✓ ${confirmed.proposedSummary}`,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, confirmationMessage]);
        // AC-16: підказка з'являється одразу після завершеної дії.
        setShowHint(true);
      })
      .catch((error: unknown) => {
        const message = isAppErrorShape(error) ? error.message : error instanceof Error ? error.message : SEND_FAILURE_MESSAGE;
        setBanner({ variant: 'error', text: message });
      })
      .finally(() => setConfirming(false));
  };

  const handleRefine = (): void => {
    // AC-02b: наступне звичайне повідомлення оновлює цю саму пропозицію
    // (sad.md §4), тому клік лише знімає фокус на композер -- сам факт
    // "хочу уточнити" не потребує окремого запиту.
  };

  // D-121 (живе тестування): перетягування правої межі -- змінює ширину лівої
  // колонки на широкому екрані (App.tsx `--chat-width`, fallback 20%). Пряма
  // мутація document.documentElement.style, НЕ useState -- мишача подія
  // mousemove стріляє десятки разів на секунду, і React-ререндер усього
  // ChatPanel (і, каскадом, App.tsx) на кожен піксель був би зайвим
  // навантаженням; CSS custom property browser застосовує сам, без React.
  // Межі 12%-50%: вужче за 12% композер знову продавлював би колонку (той
  // самий горизонтальний скрол-баг, що min-w-0 вище вже виправив при 20%,
  // але на екстремально вузькому значенні повернувся б); ширше за 50% чат
  // забирав би більше половини екрана -- за межею розумного для бічної панелі.
  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const root = document.documentElement;

    const onMouseMove = (moveEvent: MouseEvent): void => {
      const percent = (moveEvent.clientX / window.innerWidth) * 100;
      const clamped = Math.min(50, Math.max(12, percent));
      root.style.setProperty('--chat-width', `${clamped}%`);
    };
    const onMouseUp = (): void => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    // D-121 (широкий екран, живе тестування -- уточнено): на мобільному --
    // звичайна дитина grid-рядка внизу (App.tsx auto-placement, DOM-порядок).
    // На md+ -- ЯВНЕ місце в сітці App.tsx: ліва колонка 20%, УСІ 3 рядки
    // (row-span-3) -- чат тягнеться від самого верху екрана до самого низу,
    // нав-меню НЕ забирає в нього частину висоти знизу (нав на md+ стоїть
    // лише під шапкою+контентом, колонка 2 -- App.tsx). Бордер переїжджає з
    // верху (відділяє від нав-меню на мобільному) на праву сторону (відділяє
    // від шапки+контенту+нав-меню праворуч, тепер по всій висоті стовпчика).
    // border-t-0 обов'язковий -- інакше обидва бордери (top і right) діяли б
    // одночасно на md+.
    <div className="relative flex flex-col border-t border-border bg-surface-solid md:col-start-1 md:row-start-1 md:row-span-3 md:h-full md:border-t-0 md:border-r">
      {/* Хендл ЗМІНИ ШИРИНИ (D-121, живе тестування) -- тягти мишкою вправо/
          вліво, лише на md+ (`hidden md:block`, `relative` на батьківському
          div вище -- точка відліку для `absolute` тут). Ширша "зона захвату"
          (w-2, 8px), ніж сам бордер (1px) -- реальний курсор рідко влучає
          точно в лінію завтовшки 1px. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Змінити ширину чату"
        onMouseDown={handleResizeStart}
        className="absolute inset-y-0 right-0 z-10 hidden w-2 -translate-x-1/2 cursor-col-resize md:block"
      />

      {/* Хендл розгортання (D-121) -- єдиний значок зверху панелі, перемикає
          висоту контейнера нижче: 30vh (видно переписку) <-> один рядок
          (видно лише композер, переписка дістається скролом). На md+ --
          прихований (`md:hidden`): бічний стовпчик і так на всю висоту, "згорнути"
          там нічого не звужує -- нема потреби рятувати вертикальний простір,
          якого на широкому екрані вистачає. */}
      <button
        type="button"
        aria-label={expanded ? 'Згорнути переписку' : 'Розгорнути переписку'}
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="flex h-5 w-full shrink-0 items-center justify-center text-ink-faint transition-colors hover:text-ink md:hidden"
      >
        <ChevronIcon className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Переписка -- прокручується САМА ПО СОБІ, НЕ разом із композером
          (D-121, живе тестування -- третій прохід): вітання (AC-13),
          репліки, пропозиція, підказка, банер помилки. Висота контейнера --
          єдина різниця між станами (min-h-0 обов'язковий, той самий фікс,
          що App.tsx на своєму рівні -- flex-1 сам по собі не стискає дитину
          нижче її вмісту); переписка НІКОЛИ не ховається (ні unmount, ні
          max-h-0) -- згорнуто вона просто йде за межі видимої висоти й
          дістається звичайним браузерним скролом (смуга прокрутки праворуч).
          Автоскрол донизу (ефект вище, scrollRef) показує останнє
          повідомлення за замовчуванням. На md+ (хендл прихований, `expanded`
          не має значення) -- `md:max-h-none`: контейнер розтягується на всю
          решту висоти бічного стовпчика понад композер нижче. */}
      <div
        ref={scrollRef}
        className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-3 md:max-h-none ${expanded ? 'max-h-[30vh]' : 'max-h-0'}`}
      >
        {loading ? (
          <Spinner />
        ) : (
          <>
            <MessageList messages={messages} />

            {activeProposal !== null && (
              <ProposalCard
                proposedSummary={activeProposal.proposedSummary}
                onConfirm={handleConfirm}
                onRefine={handleRefine}
                confirmDisabled={confirming}
              />
            )}

            {showHint && <HintBubble text={CONFIRMED_HINT_TEXT} onDismiss={() => setShowHint(false)} />}

            {banner !== null && <Banner variant={banner.variant} text={banner.text} />}
          </>
        )}
      </div>

      {/* Композер -- ОКРЕМИЙ, НЕ прокручуваний елемент (D-121, живе
          тестування): прикріплений до низу зони вводу завжди, повністю
          незалежно від переписки вище -- на відміну від попереднього проходу
          (один спільний скрол-контейнер), скрол переписки більше не рухає
          композер, і навпаки. `shrink-0` -- завжди своя природна висота,
          ніколи не стискається заради переписки. */}
      <div onFocus={() => setShowHint(false)} className="shrink-0 px-3 pb-3 pt-2">
        <Composer onSend={handleSend} disabled={sending || loading} />
      </div>
    </div>
  );
}
