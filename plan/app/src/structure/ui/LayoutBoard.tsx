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

export interface LayoutBoardCard {
  cardId: string;
  cardTitle: string;
  cellIndex: number | null;
  baseOrder: number;
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

export function LayoutBoard({ loadLayout, onMoveCard }: LayoutBoardProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<LayoutBoardState>({ cellCount: 0, justReset: false, cards: [] });
  const [cellErrors, setCellErrors] = useState<Record<number, string>>({});
  const [banner, setBanner] = useState<{ variant: 'error' | 'info'; text: string } | null>(null);

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
        {card !== null && (
          <span draggable data-card-id={card.cardId} onDragStart={(event) => handleDragStart(event, card.cardId)}>
            {card.cardTitle}
          </span>
        )}
        {cellErrors[cellIndex] !== undefined && <span>{cellErrors[cellIndex]}</span>}
      </div>
    );
  });

  return (
    <div>
      {state.justReset && <Banner variant="info" text="Розклади заново -- попереднє розташування скинуто" />}

      {banner !== null && <Banner variant={banner.variant} text={banner.text} />}

      <div>{cells}</div>

      {unassigned.length > 0 && (
        <div data-testid="unassigned-tray">
          {unassigned.map((card) => (
            <span
              key={card.cardId}
              draggable
              data-card-id={card.cardId}
              onDragStart={(event) => handleDragStart(event, card.cardId)}
            >
              {card.cardTitle}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
