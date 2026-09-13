// SCR-03 -- Картка: зворот (Відстеження) (T26). Дашборд прогресу: частка
// виконання по кожному блоку-метриці + агрегат картки (AC-09/AC-09b),
// історія записів, що розгортається (AC-12/AC-13), і пропозиція
// перейменувати блок-метрику при колізії перенесення (AC-14/AC-15).
//
// ux-flows.md US-13: рішення про сам перенос ухвалюється зовні (`structure`'s
// SCR-04, закриття напрямку) -- ця картка лише ОТРИМУЄ результат; коли він
// зіткнувся з наявним блоком (та сама назва+одиниця), пропонує нову назву
// тут, а не мовчки зливає два блоки.
//
// ISS-45/DI (plan/app/CLAUDE.md "Правило залежностей"): та сама конвенція, що
// CardFace.tsx -- жодного fetch, жодного імпорту з ../ports чи ../app цієї ж
// картки. Дані й дії приходять як ін'єктовані пропси-функції, що повертають
// Promise; компонент сам керує локальним станом (loading/error/
// historyExpanded/колізія перейменування) навколо їхнього виклику.
import { useEffect, useRef, useState } from 'react';
import { Banner, Button, EmptyState, Spinner, TextField } from '../../../shared/ui';
import { EntryHistoryList } from './EntryHistoryList';
import { MetricBlockCard } from './MetricBlockCard';
import { MetricBlockForm } from './MetricBlockForm';
import type { MetricBlockFormValues } from './MetricBlockForm';
import type { CardBackData } from './types';

export interface CardBackProps {
  /** Завантажує дані звороту картки (блоки-метрики, історія, агрегат). */
  loadBack: () => Promise<CardBackData>;
  /** Перегорнути картку назад на лицьову сторону (SCR-02). */
  onFlip: () => void;
  /**
   * AC-12: користувач позначив запис із історії як помилковий -- виправлення
   * саме по собі завжди відбувається в чаті з агентом (ux-flows.md US-12);
   * ця проп-функція лише повідомляє про факт і повертає СВІЖИЙ стан звороту,
   * щоб історія й прогрес одразу відобразили результат.
   */
  onFlagEntry?: (entryId: string) => Promise<CardBackData>;
  /** AC-15: користувач підтвердив нову назву блоку, перенесення якого зіткнулось із наявним -- повертає свіжий стан звороту без колізії. */
  onRenameTransferredBlock?: (input: { metricBlockId: string; newLabel: string }) => Promise<CardBackData>;
  /**
   * ISS-60 (docs/ISSUES.md): створює новий блок-метрику для картки з
   * порожнього стану -- повертає лише Promise<void> (не свіжі дані), тож
   * свіжість забезпечує повторний виклик loadBack, не повернене значення.
   */
  onCreateMetricBlock?: (values: MetricBlockFormValues) => Promise<void>;
}

type LoadState = 'loading' | 'ready' | 'error';

const FALLBACK_ERROR_TEXT = 'Не вдалося завантажити картку';
const FALLBACK_COLLISION_ERROR_TEXT = 'У картці вже є блок-метрика з такою назвою й одиницею';

export function CardBack({
  loadBack,
  onFlip,
  onFlagEntry,
  onRenameTransferredBlock,
  onCreateMetricBlock,
}: CardBackProps): JSX.Element {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<CardBackData | null>(null);
  const [error, setError] = useState<string>(FALLBACK_ERROR_TEXT);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [collisionError, setCollisionError] = useState<string | undefined>(undefined);
  const [isCreatingBlock, setIsCreatingBlock] = useState(false);
  // Review 2026-09-07, post-ship follow-up review (AC-12/E remainder):
  // handleFlagEntry нижче мав ТОЙ САМИЙ баг, що refresh() уже виправлено
  // (setState('error') на невдачі стирало всі дані) -- пропущено окремо,
  // бо це власний catch, не сам refresh(). Той самий isSubmitting-підхід,
  // що T49/MetricBlockCard -- захист від подвійного кліку, поки запит у польоті.
  const [isFlaggingEntry, setIsFlaggingEntry] = useState(false);
  // Review 2026-09-07 E (T52): фоновий refresh (після успішної мутації) --
  // окремий, неблокуючий стан помилки, ніколи не `setState('error')` (той
  // самий шлях, що ПОЧАТКОВЕ завантаження) -- інакше невдалий фоновий
  // перезапит стирав уже показані дані заради банера на весь екран.
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Лічильник issued-запитів refresh(): відповідь застосовується, лише якщо
  // вона від НАЙОСТАННІШОГО виклику -- застаріла (out-of-order) відповідь,
  // що прийшла пізніше свіжішої, ігнорується, а не переписує стан.
  const refreshRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setState('loading');

    loadBack()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setRenameValue(result.pendingTransferCollision?.label ?? '');
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : FALLBACK_ERROR_TEXT);
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [loadBack]);

  /**
   * Перевантажує зворот після мутації (створення блоку, новий запис) -- той
   * самий loadBack, без окремого стану "loading" (дані вже видимі).
   * Review 2026-09-07 E (T52): помилка тут НЕ рве екран (refreshError,
   * неблокуючий Banner НАД уже показаними даними), і кожен виклик несе свій
   * id -- відповідь застосовується, лише якщо жоден ПІЗНІШИЙ refresh() ще не
   * встиг стартувати (запобігає застарілій out-of-order відповіді
   * переписати свіжішу).
   */
  const refresh = (): void => {
    const requestId = ++refreshRequestIdRef.current;
    loadBack()
      .then((result) => {
        if (refreshRequestIdRef.current !== requestId) return; // застаріла -- ігноруємо
        setData(result);
        setRenameValue(result.pendingTransferCollision?.label ?? '');
        setRefreshError(null);
      })
      .catch((err: unknown) => {
        if (refreshRequestIdRef.current !== requestId) return;
        setRefreshError(err instanceof Error ? err.message : FALLBACK_ERROR_TEXT);
      });
  };

  if (state === 'loading') {
    return <Spinner />;
  }

  if (state === 'error' || !data) {
    return <Banner variant="error" text={error} />;
  }

  const handleFlagEntry = (entryId: string): void => {
    if (!onFlagEntry || isFlaggingEntry) return;
    // Той самий requestId-лічильник, що refresh() -- onFlagEntry теж
    // повертає свіжий CardBackData, тож обидва конкурують за "останній
    // issued", не лише один одного власного класу.
    const requestId = ++refreshRequestIdRef.current;
    setIsFlaggingEntry(true);
    onFlagEntry(entryId)
      .then((fresh) => {
        if (refreshRequestIdRef.current !== requestId) return;
        setData(fresh);
        setRefreshError(null);
      })
      .catch((err: unknown) => {
        if (refreshRequestIdRef.current !== requestId) return;
        // Review 2026-09-07 (AC-12/E remainder): НЕ `setState('error')` --
        // запис уже виправлено на бекенді (PATCH пройшов), лише перезапит
        // свіжого стану провалився. Стирати весь екран заради цього так
        // само неправильно, як refresh() робив до T52.
        setRefreshError(err instanceof Error ? err.message : 'Не вдалося виправити запис');
      })
      .finally(() => setIsFlaggingEntry(false));
  };

  const handleCreateMetricBlock = (values: MetricBlockFormValues): Promise<void> => {
    if (!onCreateMetricBlock) return Promise.resolve();
    return onCreateMetricBlock(values).then(() => {
      setIsCreatingBlock(false);
      refresh();
    });
  };

  const handleConfirmRename = (): void => {
    if (!onRenameTransferredBlock || !data.pendingTransferCollision) return;
    setCollisionError(undefined);
    onRenameTransferredBlock({
      metricBlockId: data.pendingTransferCollision.metricBlockId,
      newLabel: renameValue,
    })
      .then((fresh) => setData(fresh))
      .catch((err: unknown) => {
        setCollisionError(err instanceof Error ? err.message : FALLBACK_COLLISION_ERROR_TEXT);
      });
  };

  return (
    <div>
      {/* Review 2026-09-07 E (T52): фоновий refresh невдалий -- НЕблокуючий
          банер над уже показаними даними, не заміна всього екрана. */}
      {refreshError !== null && <Banner variant="error" text={refreshError} />}

      {/* AC-14/AC-15: перенос уже стався зовні -- тут лише пропозиція
          перейменувати, коли він зіткнувся з наявним блоком тієї ж картки. */}
      {data.pendingTransferCollision && (
        <div>
          <Banner variant="error" text={FALLBACK_COLLISION_ERROR_TEXT} />
          <TextField label="Нова назва блоку-метрики" value={renameValue} onChange={setRenameValue} error={collisionError} />
          <Button label="Зберегти" onClick={handleConfirmRename} />
        </div>
      )}

      {/* D-111 (docs/DECISIONS.md): кнопка/форма створення -- ПЕРЕД будь-яким
          контентом звороту, не лише перед порожнім станом (Andrii: "+ Додати
          блок-метрику" має бути першим, що бачить користувач згори).
          Review 2026-09-07 A4 (AC-07/AC-08): рендериться НЕЗАЛЕЖНО від
          metricBlocks.length -- раніше з'являлась лише в порожньому стані,
          тож у картки з хоч одним блоком не було способу додати другий. */}
      {onCreateMetricBlock &&
        (isCreatingBlock ? (
          <MetricBlockForm onSubmit={handleCreateMetricBlock} />
        ) : (
          <Button label="+ Додати блок-метрику" onClick={() => setIsCreatingBlock(true)} />
        ))}

      {data.metricBlocks.length === 0 ? (
        <EmptyState
          message="Ще немає жодної активної метрики"
          actionHint="Додайте блок-метрику, щоб почати відстежувати прогрес"
        />
      ) : (
        <>
          {data.aggregateProgress !== null && <p>Загальний прогрес: {Math.round(data.aggregateProgress * 100)}%</p>}
          {data.metricBlocks.map((block) => (
            <MetricBlockCard key={block.id} block={block} />
          ))}
        </>
      )}

      <button type="button" onClick={() => setHistoryExpanded((expanded) => !expanded)}>
        Історія записів {historyExpanded ? '▴' : '▾'}
      </button>
      {historyExpanded && (
        <EntryHistoryList
          entries={data.entries}
          onFlagEntry={onFlagEntry ? handleFlagEntry : undefined}
          isFlagEntryDisabled={isFlaggingEntry}
        />
      )}

      {/* D-111 (docs/DECISIONS.md, виправлено): "← лицьова" -- ОСТАННІЙ
          елемент, унизу -- те саме місце, де на лицьовій стороні стоїть
          "перегорнути →" (CardFace.tsx). Живе тестування (скріншоти):
          користувач бачив кнопки вгорі на звороті й унизу на лиці -- це не
          "згруповано по стороні", а буквально ОДНЕ Й ТЕ САМЕ місце на обох
          сторонах, інакше доводиться щоразу шукати кнопки заново. */}
      <button type="button" onClick={onFlip}>
        ← лицьова
      </button>
    </div>
  );
}
