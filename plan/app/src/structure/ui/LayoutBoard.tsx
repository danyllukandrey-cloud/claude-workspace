// SCR-02 — Схема (spec.md AC-02, AC-08, AC-11b, AC-16b).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що DeclarationScreen/
// AnalyticsScreen): loadLayout/onMoveCard — ін'єктовані пропи-функції,
// жодного fetch() тут. onMoveCard мапиться 1:1 на PUT /structure/layout/{cardId}
// (contracts/openapi.yaml moveCard) — сам HTTP-запит лишається за ports/.
//
// AC-11b/AC-16b: екран сам не вирішує ЧОМУ стався reset (зміна layoutMode
// чи logicVariant, поки layoutMode лишається 'logic') — loadLayout уже
// згорнув причину в один прапорець justReset (той самий підхід, що
// AnalyticsScreen's trendAvailable). Рендер від причини не залежить:
// банер "розклади заново" + нерозкладені картки в base order внизу,
// сітка вище лишається порожньою.
//
// AC-02 (D-62, 409 structure.cell_occupied): помилка показується inline,
// прив'язана до самої клітинки, не банером/toast на всю ширину екрана
// (design-system.md "errors inline, never alert/confirm"). Мережева
// помилка (fetch сам не спрацював) — навпаки, банер, бо стосується всього
// збереження, не конкретної клітинки.

import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import { Banner, EmptyState, Spinner } from '../../shared/ui';
import { CloseCardDialog } from './CloseCardDialog';
import type {
  CloseCardDialogMetricBlock,
  CloseCardDialogTargetCard,
  CloseCardMetricTransferInput,
} from './CloseCardDialog';

export interface LayoutBoardCard {
  cardId: string;
  cardTitle: string;
  cellIndex: number | null;
  baseOrder: number;
}

/** Те, що SCR-04 має знати про картку, яку закривають (AC-12). */
export interface LayoutBoardCloseCardOptions {
  metricBlocks: CloseCardDialogMetricBlock[];
  /** Куди можна перенести метрику -- решта активних карток власника. */
  targetCards: CloseCardDialogTargetCard[];
}

export interface LayoutBoardState {
  cellCount: number;
  /** Щойно скинуто розташування (AC-11b/AC-16b) -- банер + base order внизу. */
  justReset: boolean;
  cards: LayoutBoardCard[];
}

export interface LayoutBoardProps {
  /** Завантажує поточну розкладку. */
  loadLayout: () => Promise<LayoutBoardState>;
  /** Переносить картку на нову клітинку. Кидає AppError-подібну помилку (code/httpStatus), якщо сервер відповів, або звичайну Error при мережевому збої. */
  onMoveCard: (input: { cardId: string; cellIndex: number }) => Promise<void>;
  /**
   * AC-12 -- читає, що саме пропонувати перенести при закритті напрямку
   * (GET /cards/{cardId}/metric-blocks + перелік карток-цілей). Опційний: поки
   * composition root його не підставив, дії "Закрити напрямок" просто немає --
   * краще ніж діалог, який нікуди не веде.
   */
  loadCloseCardOptions?: (cardId: string) => Promise<LayoutBoardCloseCardOptions>;
  /** AC-12 -- POST /structure/layout/{cardId}/close. Опційний разом із loadCloseCardOptions. */
  onCloseCard?: (input: { cardId: string; metricTransfers: CloseCardMetricTransferInput[] }) => Promise<void>;
}

interface AppErrorShape {
  message: string;
  code: unknown;
  httpStatus: unknown;
}

// Duck-typing замість `instanceof AppError` -- той самий підхід, що
// DeclarationScreen.tsx: тест (і реальний HTTP-шар портів) моделює "сервер
// відповів" будь-якою помилкою з полями code/httpStatus.
function isAppErrorShape(err: unknown): err is AppErrorShape {
  return typeof err === 'object' && err !== null && 'code' in err && 'httpStatus' in err;
}

export function LayoutBoard({
  loadLayout,
  onMoveCard,
  loadCloseCardOptions,
  onCloseCard,
}: LayoutBoardProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<LayoutBoardState>({ cellCount: 0, justReset: false, cards: [] });
  const [cellErrors, setCellErrors] = useState<Record<number, string>>({});
  const [banner, setBanner] = useState<{ variant: 'error' | 'info'; text: string } | null>(null);
  // AC-12: яку картку закриваємо (null -- діалог закритий) і чим його наповнити.
  // Дві окремі змінні, бо між кліком і відповіддю GET .../metric-blocks є мить,
  // коли картка вже обрана, а списку метрик ще немає -- там рендериться Spinner,
  // а не порожній діалог, який виглядав би як "метрик немає".
  const [closingCard, setClosingCard] = useState<{ cardId: string; cardTitle: string } | null>(null);
  const [closeOptions, setCloseOptions] = useState<LayoutBoardCloseCardOptions | null>(null);

  useEffect(() => {
    loadLayout().then((loaded) => {
      setState(loaded);
      setLoading(false);
    });
    // Навмисно без loadLayout у deps -- викликається рівно раз при монтуванні
    // (той самий підхід, що DeclarationScreen: DI-функція стабільна для
    // життя екрана).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <Spinner />;
  }

  if (state.cards.length === 0) {
    return <EmptyState message="Поки що немає жодної картки" actionHint="Додай картку, щоб розкласти її тут" />;
  }

  const handleDragStart = (event: DragEvent, cardId: string): void => {
    event.dataTransfer.setData('cardId', cardId);
  };

  // AC-12, вхід у SCR-04. `canCloseCard` -- обидві можливості інжектовані
  // разом: діалог без onCloseCard показував би кнопку "Закрити", яка нічого
  // не робить.
  const canCloseCard = loadCloseCardOptions !== undefined && onCloseCard !== undefined;

  const openCloseDialog = (card: LayoutBoardCard): void => {
    if (loadCloseCardOptions === undefined) {
      return;
    }

    setBanner(null);
    setCloseOptions(null);
    setClosingCard({ cardId: card.cardId, cardTitle: card.cardTitle });

    loadCloseCardOptions(card.cardId)
      .then(setCloseOptions)
      .catch((err: unknown) => {
        // Діалог НЕ відкривається напівпорожнім: без списку метрик користувач
        // не бачив би, що саме втратить, а "закрити без переносу" виглядало б
        // як єдиний варіант.
        setClosingCard(null);
        const message = err instanceof Error ? err.message : 'Не вдалося прочитати метрики картки';
        setBanner({ variant: 'error', text: `Не вдалося відкрити закриття напрямку. ${message}` });
      });
  };

  const dismissCloseDialog = (): void => {
    setClosingCard(null);
    setCloseOptions(null);
  };

  /**
   * Назва картки + (за наявності можливості) дія "Закрити напрямок". Спільний
   * рендер для сітки й для треї нерозкладених -- AC-17/AC-11b ставлять картку в
   * трей, і закрити напрямок звідти має бути так само можливо.
   *
   * aria-label несе НАЗВУ картки: кнопок на екрані стільки ж, скільки карток,
   * і без назви вони були б нерозрізненні (і для скрінрідера, і для тесту).
   */
  const cardChip = (card: LayoutBoardCard): JSX.Element => (
    <span key={card.cardId}>
      <span
        draggable
        data-card-id={card.cardId}
        onDragStart={(event) => handleDragStart(event, card.cardId)}
      >
        {card.cardTitle}
      </span>
      {canCloseCard && (
        <button
          type="button"
          aria-label={`Закрити напрямок «${card.cardTitle}»`}
          onClick={() => openCloseDialog(card)}
        >
          Закрити напрямок
        </button>
      )}
    </span>
  );

  const handleDrop = (event: DragEvent, cellIndex: number): void => {
    const cardId = event.dataTransfer.getData('cardId');
    if (!cardId) {
      return;
    }

    setCellErrors((prev) => {
      const next = { ...prev };
      delete next[cellIndex];
      return next;
    });

    onMoveCard({ cardId, cellIndex })
      .then(() => {
        setState((prev) => ({
          ...prev,
          cards: prev.cards.map((card) => (card.cardId === cardId ? { ...card, cellIndex } : card)),
        }));
      })
      .catch((err: unknown) => {
        if (isAppErrorShape(err)) {
          if (err.code === 'structure.cell_occupied') {
            setCellErrors((prev) => ({ ...prev, [cellIndex]: 'Ця клітинка вже зайнята' }));
          } else {
            setCellErrors((prev) => ({ ...prev, [cellIndex]: err.message }));
          }
        } else {
          const message = err instanceof Error ? err.message : 'Не вдалося зберегти';
          setBanner({ variant: 'error', text: `Не вдалося зберегти позицію -- мережева помилка. ${message}` });
        }
      });
  };

  const unassigned = state.cards
    .filter((card) => card.cellIndex === null)
    .sort((a, b) => a.baseOrder - b.baseOrder);

  const cells = Array.from({ length: state.cellCount }, (_, cellIndex) => {
    const card = state.cards.find((c) => c.cellIndex === cellIndex) ?? null;

    return (
      <div
        key={cellIndex}
        data-testid={`cell-${cellIndex}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, cellIndex)}
      >
        {card !== null && cardChip(card)}
        {cellErrors[cellIndex] !== undefined && <span>{cellErrors[cellIndex]}</span>}
      </div>
    );
  });

  return (
    <div>
      {state.justReset && <Banner variant="info" text="Розклади заново -- попереднє розташування скинуто" />}

      {banner !== null && <Banner variant={banner.variant} text={banner.text} />}

      <div>{cells}</div>

      {unassigned.length > 0 && <div data-testid="unassigned-tray">{unassigned.map(cardChip)}</div>}

      {/* AC-12 / SCR-04. `key` -- cardId: CloseCardDialog ініціалізує свій
          стан рядків ОДИН раз (useState(() => ...)), тож без ремаунта
          відкриття діалогу для іншої картки показувало б перемикачі
          попередньої. Назва картки -- тут, у заголовку: сам діалог її не
          рендерить (review 2026-09-11, Частина 3), а без неї незрозуміло, що
          саме закриваєш. role="dialog" -- теж звідси; фокус-пастка поки
          відсутня (знахідка рев'ю про фокус лишається відкритою). */}
      {closingCard !== null && (
        <div role="dialog" aria-label={`Закрити напрямок «${closingCard.cardTitle}»`}>
          <h2>Закрити «{closingCard.cardTitle}»?</h2>
          {closeOptions === null ? (
            <Spinner />
          ) : (
            <CloseCardDialog
              key={closingCard.cardId}
              cardTitle={closingCard.cardTitle}
              metricBlocks={closeOptions.metricBlocks}
              targetCards={closeOptions.targetCards}
              onClose={({ metricTransfers }) =>
                (onCloseCard as NonNullable<LayoutBoardProps['onCloseCard']>)({
                  cardId: closingCard.cardId,
                  metricTransfers,
                })
              }
              onClosed={() => {
                dismissCloseDialog();
                // Джерело правди -- сервер (позиція стала 'closed', метрики
                // переїхали): перечитуємо розкладку, а не вгадуємо новий стан
                // локально. screens.md SCR-04 success -- "повернення на SCR-02".
                loadLayout()
                  .then(setState)
                  .catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : 'Не вдалося оновити розкладку';
                    setBanner({ variant: 'error', text: `Напрямок закрито, але розкладку не перечитано. ${message}` });
                  });
              }}
              onCancel={dismissCloseDialog}
            />
          )}
        </div>
      )}
    </div>
  );
}
