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
import { ArchiveCardDialog } from './ArchiveCardDialog';
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
  /**
   * ISS-56 (docs/ISSUES.md): підтверджує архівацію картки (DELETE
   * /cards/{id} -- реальний запит робить викликач, T30). Прокидається без
   * змін в ArchiveCardDialog.onArchive, коли обрано "Архівувати" в меню "...".
   */
  onArchive: () => Promise<void>;
  /** ISS-56: сигнал батькові -- картку архівовано, є куди піти (App повертає до Колоди). */
  onArchived: () => void;
  /**
   * Review 2026-09-07 C10 (AC-03): зберігає Опис і/чи позначку "заповнена"
   * (PATCH /cards/{id} description/markFilled -- update-card.ts, контракт
   * уже готовий). Опційний, як onCreateMetricBlock в CardBack -- відсутній,
   * афорданс редагування Опису не рендериться.
   */
  onUpdateDescription?: (input: { description: string; markFilled: boolean }) => Promise<void>;
}

type LoadState = 'loading' | 'ready' | 'error';

const FALLBACK_ERROR_TEXT = 'Не вдалося завантажити картку';
const RENAME_FAILED_MESSAGE = 'Не вдалося зберегти назву. Перевірте зв’язок і спробуйте ще раз.';
const DESCRIPTION_FAILED_MESSAGE = 'Не вдалося зберегти опис. Перевірте зв’язок і спробуйте ще раз.';

export function CardFace({ loadCard, onFlip, onRename, onArchive, onArchived, onUpdateDescription }: CardFaceProps): JSX.Element {
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
  // ISS-56: другий пункт меню "..." -- "Архівувати" відкриває ArchiveCardDialog
  // (T29, фіксований контракт cardName/onArchive/onCancel). isArchiving --
  // незалежний від isRenaming (обидва скидаються разом при новому loadCard).
  const [isArchiving, setIsArchiving] = useState(false);
  // Review 2026-09-07 C10 (AC-03): той самий inline-патерн, що rename вище.
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [draftDescription, setDraftDescription] = useState('');
  const [draftMarkFilled, setDraftMarkFilled] = useState(false);
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | undefined>(undefined);

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
    setIsArchiving(false);
    setIsEditingDescription(false);
    setDraftDescription('');
    setDraftMarkFilled(false);
    setIsSavingDescription(false);
    setDescriptionError(undefined);

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

  function startArchive(): void {
    setIsMenuOpen(false);
    setIsArchiving(true);
  }

  function cancelArchive(): void {
    // ISS-56: "Скасувати" в діалозі -- ні onArchive, ні onArchived не викликаються.
    setIsArchiving(false);
  }

  function confirmArchive(): Promise<void> {
    return onArchive().then(() => {
      onArchived();
    });
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

  function startEditDescription(): void {
    if (!data || !onUpdateDescription) return;
    setDraftDescription(data.description ?? '');
    setDraftMarkFilled(false);
    setDescriptionError(undefined);
    setIsMenuOpen(false);
    setIsEditingDescription(true);
  }

  function cancelEditDescription(): void {
    // AC-19-подібно: "Скасувати" відкидає чернетку -- onUpdateDescription НІКОЛИ не викликається тут.
    setIsEditingDescription(false);
    setDescriptionError(undefined);
  }

  function saveDescription(): void {
    if (!onUpdateDescription) return;
    setDescriptionError(undefined);
    setIsSavingDescription(true);

    onUpdateDescription({ description: draftDescription, markFilled: draftMarkFilled })
      .then(() => {
        setData((prev) => (prev ? { ...prev, description: draftDescription } : prev));
        setIsSavingDescription(false);
        setIsEditingDescription(false);
      })
      .catch((err: unknown) => {
        // AC-03: сервер (update-card.ts) кидає пояснення "потрібен короткий
        // опис 'навіщо'" саме тут -- показуємо його як є, не вигадуємо своє.
        setDescriptionError(err instanceof Error ? err.message : DESCRIPTION_FAILED_MESSAGE);
        setIsSavingDescription(false);
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
    <div className="flex flex-col gap-4">
      {isRenaming ? (
        <div className="flex flex-col gap-3">
          <TextField label="Назва" value={draftName} onChange={setDraftName} />
          <div className="flex justify-end gap-3">
            <Button label="Скасувати" onClick={cancelRename} disabled={isSavingName} />
            <Button label="Зберегти" onClick={saveRename} disabled={isSavingName} />
          </div>
          {renameError && <Banner variant="error" text={renameError} />}
        </div>
      ) : (
        <>
          {/* AC-19: "торкається назви АБО обирає «Перейменувати» в меню" --
              обидва входи ведуть у той самий startRename. */}
          <div className="relative flex items-start justify-between gap-3">
            <h2 onClick={startRename} className="cursor-pointer font-display text-xl font-bold text-ink">
              {data.name}
            </h2>
            <button
              type="button"
              aria-label="Меню картки"
              onClick={toggleMenu}
              className="shrink-0 rounded-control px-2 py-1 text-lg font-bold leading-none text-ink-muted transition-colors hover:bg-border hover:text-ink"
            >
              ...
            </button>
            {isMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-10 mt-1 flex w-44 flex-col gap-0.5 rounded-control border border-border bg-surface-solid p-1.5 shadow-soft"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={startRename}
                  className="w-full rounded-control px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-border"
                >
                  Перейменувати
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={startArchive}
                  className="w-full rounded-control px-3 py-2 text-left text-sm font-medium text-bad transition-colors hover:bg-bad/10"
                >
                  Архівувати
                </button>
              </div>
            )}
          </div>
          {isArchiving && (
            <ArchiveCardDialog cardName={data.name} onArchive={confirmArchive} onCancel={cancelArchive} />
          )}
        </>
      )}

      {/* AC-10: непорозв'язана суперечність у даних -- показуємо, не блокуючи
          решту картки. 'info', не 'error' -- агент лише пропонує розібратись
          разом, тон без вердикту (design-system.md, D-42/D-60). */}
      {data.dataWarning && <Banner variant="info" text={data.dataWarning} />}

      {isEditingDescription ? (
        <div className="flex flex-col gap-3">
          <TextField label="Опис (навіщо)" value={draftDescription} onChange={setDraftDescription} />
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={draftMarkFilled}
              onChange={(event) => setDraftMarkFilled(event.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Позначити заповненою
          </label>
          <div className="flex justify-end gap-3">
            <Button label="Скасувати" onClick={cancelEditDescription} disabled={isSavingDescription} />
            <Button label="Зберегти" onClick={saveDescription} disabled={isSavingDescription} />
          </div>
          {descriptionError && <Banner variant="error" text={descriptionError} />}
        </div>
      ) : hasDescription ? (
        <p onClick={startEditDescription} className="cursor-pointer text-sm text-ink-muted">
          {data.description}
        </p>
      ) : (
        <p onClick={startEditDescription} className="cursor-pointer text-sm italic text-ink-faint">
          Опис ще не заповнено
        </p>
      )}

      {!isRenaming && !isEditingDescription && (
        <button
          type="button"
          onClick={onFlip}
          className="w-full rounded-control border border-border px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-border"
        >
          перегорнути →
        </button>
      )}
    </div>
  );
}
