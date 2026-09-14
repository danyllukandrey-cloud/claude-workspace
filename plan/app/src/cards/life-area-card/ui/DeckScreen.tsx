// SCR-01 -- Колода карток (T25): стартовий екран застосунку.
// Стани -- docs/features/life-area-card/screens.md, SCR-01: default / empty /
// loading / error.
//
// DI, не fetch (ISS-45): у репозиторії ще немає підключеного HTTP-транспорту
// (Express) -- ports/*.ts framework-agnostic, реальний fetch підключить
// майбутня задача T30. Тому дані компонент отримує через ІН'ЄКТОВАНИЙ проп-
// функцію loadCards, що повертає Promise -- той самий підхід DI, що вже в
// app/*.ts цієї картки (callClaude, closeStructurePosition як параметри).
// Компонент сам керує локальним станом (loading/error) навколо виклику цього
// пропу -- жодного fetch() і жодного імпорту з ports/ чи app/ цієї ж картки
// (правило залежностей, plan/app/CLAUDE.md).

import { useEffect, useState } from 'react';
import { AppError } from '../../../shared/errors';
import { Banner, Button, EmptyState, Spinner } from '../../../shared/ui';
import { DeckFrontCard } from './DeckFrontCard';
import { DeckGrid } from './DeckGrid';
import type { DeckGridItem } from './DeckGrid';
import type { MetricBlockFormValues } from './MetricBlockForm';
import type { CardBackData, CardFaceData } from './types';

const CREATE_CARD_LABEL = '+ Створити картку';
const OPEN_ARCHIVE_LABEL = 'Архів';
const LOGOUT_LABEL = 'Вийти';

export interface DeckScreenProps {
  /**
   * Завантажує активні картки поточного власника. Ін'єктована функція (DI) --
   * компонент не знає, звідки походять дані (GET /cards підключить T30).
   *
   * Контракт: має бути референційно стабільною (той самий екземпляр функції
   * між рендерами, наприклад через useCallback у виклику) -- ефект нижче
   * перезапускається при зміні посилання на loadCards, тож нестабільна
   * функція (нова лямбда щорендера) спричинить цикл повторних запитів.
   */
  loadCards: () => Promise<DeckGridItem[]>;
  /** Викликається при кліку на кнопку "+ Створити картку" (ISS-55). */
  onCreateCard: () => void;
  /** Викликається при кліку на кнопку "Архів" (ISS-55, stage 3). */
  onOpenArchive: () => void;
  /** Викликається при кліку на кнопку "Вийти" (ISS-58). */
  onLogout: () => void;
  /**
   * Review 2026-09-07 C14 (AC-04): loadCards відхилено з AppError, чий
   * httpStatus === 401 (сесія протермінована/невалідна, main.tsx) --
   * викликається ЗАМІСТЬ показу Banner-помилки, щоб користувач не впирався
   * в глухий кут (App.tsx поверне LoginScreen, той самий шлях, що onLogout).
   */
  onSessionExpired: () => void;

  // --- Передня картка (D-121, живе тестування: "картка в колоді має одразу
  // бути готова так ніби вона відкрита") -- ті самі проп-контракти, якими
  // App.tsx раніше живив окремий CardDetailScreen, тепер прокидаються сюди й
  // далі в DeckFrontCard (DeckGrid.tsx renderFront) без змін. -----------
  loadCard: (cardId: string) => Promise<CardFaceData>;
  loadBack: (cardId: string) => Promise<CardBackData>;
  onRename: (cardId: string, name: string) => Promise<void>;
  onArchive: (cardId: string) => Promise<void>;
  onUpdateDescription?: (cardId: string, input: { description: string; markFilled: boolean }) => Promise<void>;
  onFlagEntry?: (cardId: string, entryId: string) => Promise<CardBackData>;
  onCreateMetricBlock?: (cardId: string, values: MetricBlockFormValues) => Promise<void>;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; items: DeckGridItem[] }
  | { status: 'error'; message: string };

const DEFAULT_ERROR_MESSAGE = 'Не вдалося завантажити колоду карток';

export function DeckScreen({
  loadCards,
  onCreateCard,
  onOpenArchive,
  onLogout,
  onSessionExpired,
  loadCard,
  loadBack,
  onRename,
  onArchive,
  onUpdateDescription,
  onFlagEntry,
  onCreateMetricBlock,
}: DeckScreenProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // C14: "Спробувати ще раз" не може просто повторно викликати loadCards()
  // напряму (ефект нижче має лишитись єдиним місцем, що читає/пише state) --
  // інкремент цього лічильника в deps ефекту тригерить той самий цикл
  // loading -> loaded/error заново. D-121: той самий лічильник тепер служить
  // і сигналу "картку заархівовано" (DeckFrontCard.onArchived) -- перезапит
  // колоди без архівної картки, той самий підхід, що onBack мав у прибраному
  // CardDetailScreen (ремаунт через зміну ключа стану, не прямий виклик).
  const [retryToken, setRetryToken] = useState(0);
  const reload = (): void => setRetryToken((token) => token + 1);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    loadCards()
      .then((items) => {
        if (!cancelled) {
          setState({ status: 'loaded', items });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // C14/AC-04: 401 -- сесія протермінована/невалідна, не "мережа
        // недоступна" -- банер помилки тут був би глухим кутом (нема кнопки,
        // що могла б це виправити). onSessionExpired повертає до LoginScreen.
        if (error instanceof AppError && error.httpStatus === 401) {
          onSessionExpired();
          return;
        }
        const message = error instanceof Error ? error.message : DEFAULT_ERROR_MESSAGE;
        setState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [loadCards, retryToken, onSessionExpired]);

  // D-120: примітиви (Spinner/Banner/EmptyState/Button) уже самі стилізовані
  // й не приймають className -- тут стилізуються лише обгорткові контейнери
  // (тло сторінки, відступи, групування дій). Створити/Архів/Вийти лишаються
  // в тому самому порядку й одним блоком (D-111 -- кнопки однієї дії поруч).
  //
  // D-121 фікс: `h-full` (не `min-h-screen`) на всіх станах -- той самий
  // фікс, що App.tsx вже отримав (`h-dvh`/`min-h-0`): DeckScreen тепер живе
  // ВСЕРЕДИНІ вже висотно-обмеженої контентної зони app-shell, `min-h-screen`
  // тут або нічого не додає, або (гірше) продавлює контентну зону вище за її
  // бюджет висоти.
  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-bg px-4">
        <Spinner />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-full flex-col justify-center gap-4 bg-bg px-4 py-8">
        <Banner variant="error" text={state.message} />
        <Button label="Спробувати ще раз" onClick={reload} />
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div className="flex h-full flex-col gap-6 bg-bg px-4 py-8">
        <EmptyState message="Тут ще немає жодної картки" actionHint="Створіть першу картку, щоб почати" />
        <div className="mt-auto flex flex-col gap-3">
          <Button label={CREATE_CARD_LABEL} onClick={onCreateCard} />
          <Button label={OPEN_ARCHIVE_LABEL} onClick={onOpenArchive} />
          <Button label={LOGOUT_LABEL} onClick={onLogout} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 bg-bg px-4 py-6">
      <DeckGrid
        items={state.items}
        renderFront={(item) => (
          <DeckFrontCard
            cardId={item.id}
            loadCard={loadCard}
            loadBack={loadBack}
            onRename={onRename}
            onArchive={onArchive}
            onArchived={reload}
            onUpdateDescription={onUpdateDescription}
            onFlagEntry={onFlagEntry}
            onCreateMetricBlock={onCreateMetricBlock}
          />
        )}
      />
      <div className="mt-auto flex flex-col gap-3">
        <Button label={CREATE_CARD_LABEL} onClick={onCreateCard} />
        <Button label={OPEN_ARCHIVE_LABEL} onClick={onOpenArchive} />
        <Button label={LOGOUT_LABEL} onClick={onLogout} />
      </div>
    </div>
  );
}
