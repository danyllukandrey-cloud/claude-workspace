// T9 -- екран «ПЛАН»: три горизонти одним екраном (spec.md AC-01, AC-03,
// AC-03b, AC-08, AC-11).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що DeclarationScreen.tsx):
// loadPlanItems/onToggleDone/onAddPlanItem/onOpenPlanItem -- ін'єктовані
// пропи-функції, жодного fetch() тут. HTTP-транспорт підключає композиційний
// корінь (src/app/main.tsx, T11).
//
// Чому екран приймає ПЛОСКИЙ список, а не готове групування: саме так його
// віддає контракт (contracts/openapi.yaml, `PlanItemPage.items` -- один
// плоский список із курсором). Групування по горизонтах -- показова форма,
// тож живе тут, поруч із показом, а не дублюється в транспорті.
//
// Порядок горизонтів -- PLAN_HORIZONS (тактичний -> оперативний ->
// стратегічний), порядок усередині горизонту -- як прийшов із сервера
// (за датою додавання, AC-08; ручного перевпорядкування у v1 нема).
//
// AC-11: порожній горизонт показує СВОЮ кнопку «+», а не EmptyState. Текст
// «тут порожньо» першому користувачу нічого не дає -- йому потрібна дія, а
// кнопка «+» і є ця дія; вона ж стоїть у непорожньому горизонті, бо наперед
// невідомо, скільки пунктів комусь знадобиться (spec.md §1, уточнення
// `clarify`).
//
// Оптимістичний чекбокс: стан перемикається одразу (AC-03 -- «позначає
// виконаним НЕГАЙНО»), а збій збереження повертає його назад і показує
// Banner. Інакше користувач бачив би галочку там, де сервер її не прийняв.
//
// Review 2026-09-20 (stage-2): до цього фіксу невдале завантаження
// (loadPlanItems відхилено) лишало екран у стані "loading" НАЗАВЖДИ --
// жодного Banner, жодної кнопки "Спробувати ще раз". Той самий шаблон
// loading/loaded/error + retryToken + onSessionExpired, що вже в
// DeckScreen.tsx (SCR-01) -- ПЛАН досі був єдиним екраном без нього.

import { useEffect, useState } from 'react';
import { AppError } from '../../shared/errors';
import { Banner, IconButton, Spinner, Button } from '../../shared/ui';
import { PLAN_HORIZONS } from '../domain/plan-item';
import type { PlanHorizon } from '../domain/plan-item';

/** Форма пункту, яку показує екран -- рівно `components.schemas.PlanItem` контракту. */
export interface PlanScreenItem {
  id: string;
  horizon: PlanHorizon;
  planText: string;
  done: boolean;
  /** ISO 8601 -- дата ДОДАВАННЯ пункту, незмінна після створення (AC-01/AC-08). */
  createdAt: string;
}

export interface PlanScreenProps {
  /** Завантажує всі активні пункти плану користувача (плоский список). */
  loadPlanItems: () => Promise<PlanScreenItem[]>;
  /** Зберігає новий стан чекбокса «виконано» (AC-03/AC-03b). */
  onToggleDone: (item: PlanScreenItem, done: boolean) => Promise<void>;
  /** Відкриває редактор НОВОГО пункту в цьому горизонті (AC-01). */
  onAddPlanItem: (horizon: PlanHorizon) => void;
  /** Відкриває редактор саме цього наявного пункту (AC-04 -- очищення тексту). */
  onOpenPlanItem: (item: PlanScreenItem) => void;
  /**
   * Review 2026-09-20: loadPlanItems, відхилений з AppError, чий
   * httpStatus === 401 (сесія протермінована/невалідна) -- той самий
   * контракт, що DeckScreen.tsx (C14/AC-04) уже має. onSessionExpired
   * повертає до LoginScreen замість глухого банера помилки без дії.
   */
  onSessionExpired: () => void;
}

export const PLAN_HORIZON_LABELS: Record<PlanHorizon, string> = {
  tactical: 'Тактичний',
  operational: 'Оперативний',
  strategic: 'Стратегічний',
};

// Живе тестування (Андрій): часові діапазони (до року / 3-5 років / 10+
// років) не складались в один суцільний план -- проміжки між ними (2 роки,
// потім 5) читались як розриви, а не як три частини одного цілого. Підказки
// тепер описують РОЛЬ горизонту в плануванні, не конкретний строк.
const PLAN_HORIZON_HINTS: Record<PlanHorizon, string> = {
  tactical: 'план на найближчий час',
  operational: 'план на декілька років',
  strategic: 'план з найвіддаленішими цілями',
};

// День і місяць без року -- ЛИШЕ коли рік пункту збігається з поточним
// (у списку намірів це майже завжди так, і показувати рік щоразу було б
// шумом). Review 2026-09-20 (AC-08): тактичний горизонт (до року) майже
// завжди в поточному році й так, але стратегічний (10+ років) міг раніше
// вигдядати однаково для пункту, доданого торік, і доданого сьогодні --
// рік тепер показується щоразу, коли він не поточний, для будь-якого
// горизонту (не лише стратегічного -- той самий edge case технічно можливий
// і для тактичного/оперативного, просто рідше).
function formatAddedAt(createdAt: string, now: Date = new Date()): string {
  const added = new Date(createdAt);
  const sameYear = added.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: sameYear ? undefined : 'numeric',
  }).format(added);
}

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; items: PlanScreenItem[] }
  | { status: 'error'; message: string };

const DEFAULT_ERROR_MESSAGE = 'Не вдалося завантажити сторінку ПЛАН';

export function PlanScreen({
  loadPlanItems,
  onToggleDone,
  onAddPlanItem,
  onOpenPlanItem,
  onSessionExpired,
}: PlanScreenProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [items, setItems] = useState<PlanScreenItem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Той самий "лічильник -> перезапустити ефект" підхід, що DeckScreen.tsx's
  // retryToken -- кнопка "Спробувати ще раз" не викликає loadPlanItems
  // напряму, а лише тригерить ефект нижче, щоб стан loading/loaded/error
  // лишався в одному місці.
  const [retryToken, setRetryToken] = useState(0);
  const reload = (): void => setRetryToken((token) => token + 1);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    loadPlanItems()
      .then((loaded) => {
        if (cancelled) return;
        setItems(loaded);
        setState({ status: 'loaded', items: loaded });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
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
    // Навмисно без loadPlanItems у deps -- та сама причина, що DeckScreen.tsx:
    // DI-функція стабільна для життя екрана, лише retryToken/onSessionExpired
    // мають перезапускати ефект.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken, onSessionExpired]);

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

  const setDoneLocally = (id: string, done: boolean): void => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, done } : item)));
  };

  const toggle = async (item: PlanScreenItem): Promise<void> => {
    const next = !item.done;
    setSaveError(null);
    setDoneLocally(item.id, next);

    try {
      await onToggleDone(item, next);
    } catch (err: unknown) {
      // Сервер не прийняв зміну -- повертаємо чекбокс у попередній стан, щоб
      // екран не показував прогрес, якого насправді немає.
      setDoneLocally(item.id, item.done);
      setSaveError(err instanceof Error ? err.message : 'Не вдалося зберегти');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto px-4 py-6">
      {saveError !== null && <Banner variant="error" text={saveError} />}

      {PLAN_HORIZONS.map((horizon, index) => {
        const label = PLAN_HORIZON_LABELS[horizon];
        const horizonItems = items.filter((item) => item.horizon === horizon);
        // Живе тестування (Андрій): три горизонти читались як один суцільний
        // список без меж -- видима лінія-роздільник над кожним блоком, крім
        // першого (перший не потребує лінії над самим верхом сторінки).
        const sectionClassName =
          index === 0 ? 'flex flex-col gap-2' : 'flex flex-col gap-2 border-t border-border pt-6';

        return (
          <section key={horizon} aria-label={label} className={sectionClassName}>
            <h2 className="text-sm font-bold text-ink">
              {label} <span className="font-normal text-ink-muted">({PLAN_HORIZON_HINTS[horizon]})</span>
            </h2>

            <ul className="flex flex-col gap-1.5">
              {horizonItems.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    aria-label={item.planText}
                    checked={item.done}
                    onChange={() => void toggle(item)}
                    // Живе тестування (Андрій): синій за замовчуванням не
                    // асоціюється з "виконано" -- зелений (--color-good,
                    // theme.css) навмисне ВІДХИЛЕННЯ від нейтрального
                    // accent-ink, який має кожен інший чекбокс продукту
                    // (CardBack.tsx/RuleSettingsScreen.tsx/LayoutBoard.tsx/
                    // CloseCardDialog.tsx) -- тут стан "виконано" сам є
                    // семантичним сигналом, а не нейтральним перемикачем.
                    className="h-4 w-4 rounded border-border accent-good"
                  />
                  <span
                    onClick={() => onOpenPlanItem(item)}
                    // Живе тестування (Андрій): закреслення тексту читалось
                    // як "помилка/видалено", не як "готово" -- курсив м'якше
                    // передає завершеність; ink-muted (не ink, не line-through)
                    // тримає текст темно-сірим, а не чорним.
                    className={`flex-1 cursor-pointer ${item.done ? 'text-ink-muted italic' : ''}`}
                  >
                    {item.planText}
                  </span>
                  <span className="text-xs italic text-ink-faint">{formatAddedAt(item.createdAt)}</span>
                </li>
              ))}
            </ul>

            <IconButton
              label={`Додати пункт: ${label}`}
              onClick={() => onAddPlanItem(horizon)}
              className="self-start border border-border bg-surface shadow-btn backdrop-blur-xl"
            >
              +
            </IconButton>
          </section>
        );
      })}
    </div>
  );
}
