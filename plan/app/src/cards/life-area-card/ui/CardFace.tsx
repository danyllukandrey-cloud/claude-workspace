// SCR-02 -- Картка: лицьова сторона (T26). Назва + Опис (навіщо),
// попередження агента про підозрілі дані (AC-10), або стан
// завантаження/помилки при відкритті картки.
//
// Стан "rename" (AC-19, T37) додано ПОВЕРХ наявного файлу (ISS-40,
// docs/ISSUES.md) -- торкання назви АБО меню "..." -> "Перейменувати" --
// обидва входи ведуть у ту саму inline-редаговану назву через TextField ->
// Зберегти/Скасувати (screens.md SCR-02, AC-19 явно називає обидва шляхи).
//
// ISS-45/DI (plan/app/CLAUDE.md "Правило залежностей"): жодного fetch і
// жодного імпорту з ../ports чи ../app цієї ж картки -- реального HTTP-
// транспорту в репозиторії ще нема (framework-agnostic ports/*.ts, підключить
// майбутня T30). `loadCard`/`onRename` -- ін'єктовані проп-функції, що
// повертають Promise, той самий стиль DI, що вже в ../app/*.ts (callClaude,
// closeStructurePosition як опційні параметри use-case). Компонент сам керує
// локальним станом (loading/error/rename) навколо їхніх викликів.
//
// ISS-41 (DoD дескоуплено, docs/ISSUES.md): буквальний DoD T37 вимагав
// перевірити запис у Літопис Структури (structure AC-15) -- сервіс не існує
// жодним рядком коду (ISS-28), тому тест і код нижче цього НЕ роблять.
import { useEffect, useState } from 'react';
import { Banner, Button, Spinner, TextField } from '../../../shared/ui';
import type { CardFaceData } from './types';

export interface CardFaceProps {
  /** Завантажує дані лицьової сторони картки. */
  loadCard: () => Promise<CardFaceData>;
  /** Перегорнути картку на зворот (SCR-03). */
  onFlip: () => void;
  /**
   * Зберігає нову назву картки (AC-19, PATCH /cards/{id} name -- T21,
   * контракт уже готовий). Викликається лише з "Зберегти" в стані "rename";
   * "Скасувати" відкидає чернетку без цього виклику.
   */
  onRename: (name: string) => Promise<void>;
}

type LoadState = 'loading' | 'ready' | 'error';

const FALLBACK_ERROR_TEXT = 'Не вдалося завантажити картку';
const RENAME_FAILED_MESSAGE = 'Не вдалося зберегти назву. Перевірте зв’язок і спробуйте ще раз.';

export function CardFace({ loadCard, onFlip, onRename }: CardFaceProps): JSX.Element {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<CardFaceData | null>(null);
  const [error, setError] = useState<string>(FALLBACK_ERROR_TEXT);

  // Меню "..." і стан "rename" -- незалежні від loading/ready/error вище:
  // rename можливий лише коли картка вже завантажена (ready), тому
  // isMenuOpen/isRenaming скидаються при кожному новому loadCard (ефект нижче).
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [renameError, setRenameError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    // Реально скидаємо (не лише коментарем обіцяємо) -- інакше відкрите меню
    // чи чернетка перейменування зі старої картки лишились би поверх нових
    // даних, якщо loadCard проп зміниться (наприклад, батько перемкнув
    // картку) під час відкритого меню чи режиму rename.
    setIsMenuOpen(false);
    setIsRenaming(false);
    setDraftName('');
    setIsSavingName(false);
    setRenameError(undefined);

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

  function toggleMenu(): void {
    setIsMenuOpen((prev) => !prev);
  }

  function startRename(): void {
    if (!data) return;
    setDraftName(data.name);
    setRenameError(undefined);
    setIsMenuOpen(false);
    setIsRenaming(true);
  }

  function cancelRename(): void {
    // AC-19: "Скасувати" відкидає чернетку -- onRename НІКОЛИ не викликається тут.
    setIsRenaming(false);
    setRenameError(undefined);
  }

  function saveRename(): void {
    setRenameError(undefined);
    setIsSavingName(true);

    onRename(draftName)
      .then(() => {
        // Назва в колоді/картці оновлюється одразу з локального draftName --
        // сервер уже підтвердив запис (PATCH /cards/{id}, T21).
        setData((prev) => (prev ? { ...prev, name: draftName } : prev));
        setIsSavingName(false);
        setIsRenaming(false);
        // TODO(ISS-28): коли зʼявиться сервіс Літопису Структури (structure
        // AC-15), тут піде виклик запису події перейменування. Сервіс ще не
        // існує жодним рядком коду -- виклику навмисно немає (ISS-41).
      })
      .catch((err: unknown) => {
        setRenameError(err instanceof Error ? err.message : RENAME_FAILED_MESSAGE);
        setIsSavingName(false);
      });
  }

  if (state === 'loading') {
    return <Spinner />;
  }

  if (state === 'error' || !data) {
    return <Banner variant="error" text={error} />;
  }

  const hasDescription = Boolean(data.description && data.description.trim());

  return (
    <div>
      {isRenaming ? (
        <>
          <TextField label="Назва" value={draftName} onChange={setDraftName} />
          <Button label="Скасувати" onClick={cancelRename} disabled={isSavingName} />
          <Button label="Зберегти" onClick={saveRename} disabled={isSavingName} />
          {renameError && <Banner variant="error" text={renameError} />}
        </>
      ) : (
        <>
          {/* AC-19: "торкається назви АБО обирає «Перейменувати» в меню" --
              обидва входи ведуть у той самий startRename. */}
          <h2 onClick={startRename}>{data.name}</h2>
          <button type="button" aria-label="Меню картки" onClick={toggleMenu}>
            ...
          </button>
          {isMenuOpen && (
            <div role="menu">
              <button type="button" role="menuitem" onClick={startRename}>
                Перейменувати
              </button>
            </div>
          )}
        </>
      )}

      {/* AC-10: непорозв'язана суперечність у даних -- показуємо, не блокуючи
          решту картки. 'info', не 'error' -- агент лише пропонує розібратись
          разом, тон без вердикту (design-system.md, D-42/D-60). */}
      {data.dataWarning && <Banner variant="info" text={data.dataWarning} />}

      {hasDescription ? <p>{data.description}</p> : <p>Опис ще не заповнено</p>}

      {!isRenaming && (
        <button type="button" onClick={onFlip}>
          перегорнути →
        </button>
      )}
    </div>
  );
}
