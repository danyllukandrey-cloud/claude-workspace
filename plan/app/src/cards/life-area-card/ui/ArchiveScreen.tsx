// SCR-07 -- Архів карток (T36): список архівованих карток (US-16, AC-18) і
// перегляд однієї архівованої картки з можливістю розархівувати (AC-17).
//
// default стан ПЕРЕВИКОРИСТОВУЄ наявний DeckGrid (T25, ISS-46) у режимі
// "архів" -- DeckGrid навмисно узагальнений (items+onOpen, нічого не знає
// про статус картки), тож нової сітки тайлів тут не пишемо. card-view --
// CardShell (shared/ui) + Button "Розархівувати" (AC-17) + read-only історія
// записів (AC-18: "історія записів видима"); поки картка не розархівована,
// новий запис на ній недоступний (тут немає жодної дії його додати), і сама
// історія тут суто для перегляду -- без "виправити" (EntryHistoryList,
// T26/AC-12, тому не використовується напряму: та дія стосується активної
// картки, не архівної).
//
// ISS-45/DI (plan/app/CLAUDE.md "Правило залежностей"): жодного fetch і
// жодного імпорту з ../ports чи ../app цієї ж картки -- реальний HTTP-
// транспорт (Express) підключить майбутня задача T30. Дані й дії компонент
// отримує через ІН'ЄКТОВАНІ пропси-функції, що повертають Promise -- той
// самий стиль DI, що вже в DeckScreen.tsx/CardFace.tsx цього ж репозиторію.
import { useEffect, useState } from 'react';
import { Banner, Button, CardShell, EmptyState, Spinner } from '../../../shared/ui';
import { DeckGrid } from './DeckGrid';
import type { DeckGridItem } from './DeckGrid';
import type { EntryViewModel } from './types';

export interface ArchiveScreenProps {
  /**
   * Завантажує архівовані картки поточного власника (US-16, AC-18). Ін'єктована
   * функція (DI) -- компонент не знає, звідки походять дані (GET
   * /cards?status=archived підключить T30).
   *
   * Контракт: має бути референційно стабільною (той самий екземпляр функції
   * між рендерами) -- ефект нижче перезапускається при зміні посилання.
   */
  loadArchivedCards: () => Promise<DeckGridItem[]>;
  /**
   * Розархівовує картку (T35, AC-17): status archived -> active. Реальний
   * PATCH-виклик підключить T30 -- тут лише повідомляємо про намір і чекаємо
   * Promise<void>. Після успіху картка видаляється з локального списку
   * архіву без повторного GET.
   */
  onRestoreCard: (cardId: string) => Promise<void>;
  /**
   * AC-18 ("історія записів видима"): завантажує історію записів обраної
   * архівованої картки для режиму перегляду. Read-only -- на відміну від
   * CardBack.loadBack (T26), тут немає онFlagEntry/агрегату/блоків-метрик:
   * архівна картка показує лише сам факт "що записано і коли", без жодної дії.
   */
  loadArchivedCardHistory: (cardId: string) => Promise<EntryViewModel[]>;
}

type HistoryState =
  | { status: 'loading' }
  | { status: 'ready'; entries: EntryViewModel[] }
  | { status: 'error'; message: string };

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'list'; items: DeckGridItem[] }
  | {
      status: 'card-view';
      items: DeckGridItem[];
      card: DeckGridItem;
      restoreError: string | null;
      isRestoring: boolean;
      history: HistoryState;
    };

const DEFAULT_LOAD_ERROR = 'Не вдалося завантажити архів карток';
const DEFAULT_RESTORE_ERROR = 'Не вдалося розархівувати картку';
const DEFAULT_HISTORY_ERROR = 'Не вдалося завантажити історію записів';

export function ArchiveScreen({
  loadArchivedCards,
  onRestoreCard,
  loadArchivedCardHistory,
}: ArchiveScreenProps): JSX.Element {
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    loadArchivedCards()
      .then((items) => {
        if (!cancelled) {
          setState({ status: 'list', items });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : DEFAULT_LOAD_ERROR;
          setState({ status: 'error', message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadArchivedCards]);

  if (state.status === 'loading') {
    return <Spinner />;
  }

  if (state.status === 'error') {
    return <Banner variant="error" text={state.message} />;
  }

  if (state.status === 'card-view') {
    const { card, items, restoreError, isRestoring, history } = state;

    const handleRestore = (): void => {
      setState({ status: 'card-view', items, card, restoreError: null, isRestoring: true, history });
      onRestoreCard(card.id)
        .then(() => {
          // AC-17: після успіху картка зникає зі списку архіву -- назад до
          // list з відфільтрованими items, без повторного GET.
          setState({ status: 'list', items: items.filter((item) => item.id !== card.id) });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : DEFAULT_RESTORE_ERROR;
          setState({ status: 'card-view', items, card, restoreError: message, isRestoring: false, history });
        });
    };

    return (
      <div>
        <h1>Архів карток</h1>
        <CardShell
          isFlipped={false}
          front={
            <div>
              <h2>{card.name}</h2>
            <p>Картка в архіві -- новий запис недоступний, поки її не розархівовано</p>
            <Button label="Розархівувати" onClick={handleRestore} disabled={isRestoring} />
            {restoreError !== null && <Banner variant="error" text={restoreError} />}

            {history.status === 'loading' && <Spinner />}
            {history.status === 'error' && <Banner variant="error" text={history.message} />}
            {history.status === 'ready' && (
              <div>
                <h3>Історія записів</h3>
                <ul>
                  {history.entries.map((entry) => (
                    <li key={entry.id}>
                      <span>{entry.recordedAtLabel}</span> <span>{entry.summary}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          }
          back={null}
        />
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div>
        <h1>Архів карток</h1>
        <EmptyState message="Архів порожній" actionHint="Заархівовані картки з'являться тут після архівації" />
      </div>
    );
  }

  const items = state.items;
  const handleOpen = (id: string): void => {
    const card = items.find((item) => item.id === id);
    if (!card) return;

    setState({
      status: 'card-view',
      items,
      card,
      restoreError: null,
      isRestoring: false,
      history: { status: 'loading' },
    });

    loadArchivedCardHistory(id)
      .then((entries) => {
        setState((current) =>
          current.status === 'card-view' && current.card.id === id
            ? { ...current, history: { status: 'ready', entries } }
            : current,
        );
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : DEFAULT_HISTORY_ERROR;
        setState((current) =>
          current.status === 'card-view' && current.card.id === id
            ? { ...current, history: { status: 'error', message } }
            : current,
        );
      });
  };

  return (
    <div>
      <h1>Архів карток</h1>
      <DeckGrid items={items} onOpen={handleOpen} />
    </div>
  );
}
