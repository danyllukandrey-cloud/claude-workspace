// SCR-01 -- Чат (screens.md), spec.md AC-01/02/02b/03/04/05/09/10/10b/13/15
// (T26). 9 станів з tasks.json T26 DoD: default / empty-onboarding / loading
// / proposal-pending / confirmed / clarifying / attachment-error /
// rate-limited / llm-unavailable. "confirmed-hint" (10-й стан screens.md)
// НАВМИСНО не тут -- T47 додає HintBubble + цей стан окремим проходом
// (tasks.json T47 deps: [T25, T26], редагує саме цей файл).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що RuleSettingsScreen.tsx, T27):
// loadHistory/loadOnboarding/loadActiveProposal/sendMessage/confirmProposal
// -- ін'єктовані функції, жодного fetch() тут. Реальний HTTP-транспорт --
// ports/chat-handler.ts (T20) + ports/proposal-handler.ts (T21), обидва вже
// реалізовані; підключає майбутній викликач (T29 wiring).
//
// "Ти:"/"Агент:" з wireframe -- MessageBubble/MessageList (T25) уже
// візуалізують роль через data-role, текстовий префікс не додаємо тут
// повторно (той самий підхід, що вже усталений у T25).
//
// clarifying (AC-04/AC-05) -- НЕ окремий код-шлях: це просто default-рендер,
// де останнє повідомлення агента -- запитання, не пропозиція (screens.md
// wireframe відрізняється лише ЗМІСТОМ останнього повідомлення, не
// структурою екрана) -- відповідно немає окремої гілки нижче, лише той факт,
// що ProposalCard не рендериться, коли activeProposal === null.
//
// confirmed-hint (AC-16/AC-16b, T47) -- дисмісибл-підказка над Composer
// одразу після завершеної дії (AC-16 приклад: підтвердження запису, AC-02).
// Статичний текст інтерфейсу, НЕ репліка агента (AC-16 explicitly, D-43) --
// HintBubble (T47) рендериться тут, ChatScreen сам вирішує коли showHint
// true/false, бо саме тут відомо про "завершену дію" (confirmProposal) і
// про фокус Composer (AC-16b, друга причина дисмісу).
//
// "confirmed" (AC-02) -- MessageTurn/ProposalConfirm (T20/T21) не повертають
// нове chat_message з текстом підтвердження (лише оновлений Proposal) --
// той підпис "Агент: записано ✓ ..." (screens.md wireframe) синтезується
// локально цим екраном одразу після успішного confirmProposal, той самий
// підхід, що MetricBlockCard раніше синтезував локальний фідбек до
// реального round-trip.
//
// "Уточнити" (ProposalCard.onRefine) -- навмисно без API-виклику: наступне
// звичайне повідомлення в Composer саме оновлює активну пропозицію
// (AC-02b, sad.md §4), тому клік лише знімає фокус на композер -- сам факт
// "хочу уточнити" не потребує окремого запиту.

import { useEffect, useState } from 'react';
import { Banner, Spinner } from '../../shared/ui';
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

export interface ChatScreenProps {
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

export function ChatScreen({
  loadHistory,
  loadOnboarding,
  loadActiveProposal,
  sendMessage,
  confirmProposal,
}: ChatScreenProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeProposal, setActiveProposal] = useState<ChatProposal | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadHistory(), loadOnboarding(), loadActiveProposal()]).then(([history, onboarding, proposal]) => {
      if (cancelled) return;
      // AC-13: перший-візит-без-історії -- вітання зверху; історія вже містить
      // це саме повідомлення на всіх наступних заходах (onboarding.message === null тоді).
      const initial = history.length === 0 && onboarding.message !== null ? [onboarding.message] : history;
      setMessages(initial);
      setActiveProposal(proposal);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // Ін'єктовані функції лишаються стабільними для життя екрана (той самий
    // підхід, що DeclarationScreen/RuleSettingsScreen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <Spinner />;
  }

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
    // (sad.md §4) -- сам клік навмисно нічого не викликає, це лише сигнал
    // наміру користувача, без API-запиту (ProposalCard.onRefine, T25).
  };

  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-display text-xl font-bold text-ink">Чат</h1>

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

      {/* AC-16b: друга причина дисмісу -- фокус на Composer. onFocus у React
          бубблиться (делегування через focusin), тож фокус на внутрішньому
          input-і Composer (T25, не редагується цим файлом) спливає сюди. */}
      <div onFocus={() => setShowHint(false)}>
        <Composer onSend={handleSend} disabled={sending} />
      </div>

      {banner !== null && <Banner variant={banner.variant} text={banner.text} />}
    </div>
  );
}
