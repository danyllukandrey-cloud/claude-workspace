// SCR-02 -- Картка: лицьова сторона (T26). Назва + Опис (навіщо),
// попередження агента про підозрілі дані (AC-10), або стан
// завантаження/помилки при відкритті картки.
//
// Заголовок лишається СТАТИЧНИМ текстом навмисно (задача Notes): inline-
// перейменування -- стан "rename" зі screens.md (AC-19) -- додає T37 у ЦЕЙ
// САМИЙ файл ПІЗНІШЕ (ISS-40, docs/ISSUES.md). Цей файл того стану не рендерить.
//
// ISS-45/DI (plan/app/CLAUDE.md "Правило залежностей"): жодного fetch і
// жодного імпорту з ../ports чи ../app цієї ж картки -- реального HTTP-
// транспорту в репозиторії ще нема (framework-agnostic ports/*.ts, підключить
// майбутня T30). `loadCard` -- ін'єктована проп-функція, що повертає Promise,
// той самий стиль DI, що вже в ../app/*.ts (callClaude, closeStructurePosition
// як опційні параметри use-case). Компонент сам керує локальним станом
// (loading/error) навколо її виклику.
import { useEffect, useState } from 'react';
import { Banner, Spinner } from '../../../shared/ui';
import type { CardFaceData } from './types';

export interface CardFaceProps {
  /** Завантажує дані лицьової сторони картки. */
  loadCard: () => Promise<CardFaceData>;
  /** Перегорнути картку на зворот (SCR-03). */
  onFlip: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

const FALLBACK_ERROR_TEXT = 'Не вдалося завантажити картку';

export function CardFace({ loadCard, onFlip }: CardFaceProps): JSX.Element {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<CardFaceData | null>(null);
  const [error, setError] = useState<string>(FALLBACK_ERROR_TEXT);

  useEffect(() => {
    let cancelled = false;
    setState('loading');

    loadCard()
      .then((result) => {
        if (cancelled) return;
        setData(result);
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
  }, [loadCard]);

  if (state === 'loading') {
    return <Spinner />;
  }

  if (state === 'error' || !data) {
    return <Banner variant="error" text={error} />;
  }

  const hasDescription = Boolean(data.description && data.description.trim());

  return (
    <div>
      <h2>{data.name}</h2>

      {/* AC-10: непорозв'язана суперечність у даних -- показуємо, не блокуючи
          решту картки. 'info', не 'error' -- агент лише пропонує розібратись
          разом, тон без вердикту (design-system.md, D-42/D-60). */}
      {data.dataWarning && <Banner variant="info" text={data.dataWarning} />}

      {hasDescription ? <p>{data.description}</p> : <p>Опис ще не заповнено</p>}

      <button type="button" onClick={onFlip}>
        перегорнути →
      </button>
    </div>
  );
}
