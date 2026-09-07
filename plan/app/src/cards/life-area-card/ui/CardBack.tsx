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
import { useEffect, useState } from 'react';
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
  /** ТИМЧАСОВО (D-110, docs/DECISIONS.md) -- вносить запис для блоку metricBlockId; відсутній -- кнопка "+" на плитках не рендериться. */
  onAddEntry?: (metricBlockId: string, amount: number) => Promise<void>;
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
  onAddEntry,
}: CardBackProps): JSX.Element {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<CardBackData | null>(null);
  const [error, setError] = useState<string>(FALLBACK_ERROR_TEXT);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [collisionError, setCollisionError] = useState<string | undefined>(undefined);
  const [isCreatingBlock, setIsCreatingBlock] = useState(false);

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

  /** Перевантажує зворот після мутації (створення блоку, новий запис) -- той самий loadBack, без окремого стану "loading" (дані вже видимі). */
  const refresh = (): void => {
    loadBack()
      .then((result) => {
        setData(result);
        setRenameValue(result.pendingTransferCollision?.label ?? '');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : FALLBACK_ERROR_TEXT);
        setState('error');
      });
  };

  if (state === 'loading') {
    return <Spinner />;
  }

  if (state === 'error' || !data) {
    return <Banner variant="error" text={error} />;
  }

  const handleFlagEntry = (entryId: string): void => {
    if (!onFlagEntry) return;
    onFlagEntry(entryId)
      .then((fresh) => setData(fresh))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Не вдалося виправити запис');
        setState('error');
      });
  };

  const handleCreateMetricBlock = (values: MetricBlockFormValues): Promise<void> => {
    if (!onCreateMetricBlock) return Promise.resolve();
    return onCreateMetricBlock(values).then(() => {
      setIsCreatingBlock(false);
      refresh();
    });
  };

  const handleAddEntry = (metricBlockId: string, amount: number): Promise<void> => {
    if (!onAddEntry) return Promise.resolve();
    return onAddEntry(metricBlockId, amount).then(() => {
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
      {/* AC-14/AC-15: перенос уже стався зовні -- тут лише пропозиція
          перейменувати, коли він зіткнувся з наявним блоком тієї ж картки. */}
      {data.pendingTransferCollision && (
        <div>
          <Banner variant="error" text={FALLBACK_COLLISION_ERROR_TEXT} />
          <TextField label="Нова назва блоку-метрики" value={renameValue} onChange={setRenameValue} error={collisionError} />
          <Button label="Зберегти" onClick={handleConfirmRename} />
        </div>
      )}

      {data.metricBlocks.length === 0 ? (
        <>
          <EmptyState
            message="Ще немає жодної активної метрики"
            actionHint="Додайте блок-метрику, щоб почати відстежувати прогрес"
          />
          {onCreateMetricBlock &&
            (isCreatingBlock ? (
              <MetricBlockForm onSubmit={handleCreateMetricBlock} />
            ) : (
              <Button label="+ Додати блок-метрику" onClick={() => setIsCreatingBlock(true)} />
            ))}
        </>
      ) : (
        <>
          {data.aggregateProgress !== null && <p>Загальний прогрес: {Math.round(data.aggregateProgress * 100)}%</p>}
          {data.metricBlocks.map((block) => (
            <MetricBlockCard
              key={block.id}
              block={block}
              onAddEntry={onAddEntry ? (amount) => handleAddEntry(block.id, amount) : undefined}
            />
          ))}
        </>
      )}

      <button type="button" onClick={() => setHistoryExpanded((expanded) => !expanded)}>
        Історія записів {historyExpanded ? '▴' : '▾'}
      </button>
      {historyExpanded && <EntryHistoryList entries={data.entries} onFlagEntry={handleFlagEntry} />}

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
