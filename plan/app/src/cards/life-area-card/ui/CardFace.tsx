// SCR-02 -- Картка: лицьова сторона (T26). Назва + Опис (навіщо),
// попередження агента про підозрілі дані (AC-10), або стан
// завантаження/помилки при відкритті картки.
//
// CH-05/CH-06 (docs/features/life-area-card/changes.md, живе тестування
// 2026-09-21): "Перейменувати" -> "Редагувати", і Назва+Опис редагуються
// ОДНІЄЮ спільною формою (раніше -- два незалежні inline-стани: rename
// торкався лише Назви, Опис відкривався ОКРЕМИМ кліком по своєму тексту --
// "проміжний екран", де верхнє поле вже редаговане, а нижнє ще ні, читався
// як зайвий крок). Обидва входи (меню "..." -> "Редагувати", клік на Назву
// АБО на Опис) ведуть у той самий startEdit. "Скасувати"/"Скасувати" (два
// незалежні набори кнопок) -- одна пара "На зад"/"Зберегти" на всю форму.
// "Позначити заповненою" (окремий чекбокс) прибрано -- markFilled тепер
// похідне від тексту (непорожній збережений Опис = заповнена), не ручний
// перемикач: AC-03 (бекенд блокує markFilled без Опису) лишається чинним
// сама по собі -- просто той стан, який AC-03 забороняв, тепер неможливо
// навіть спробувати створити з UI.
//
// ISS-45/DI (plan/app/CLAUDE.md "Правило залежностей"): жодного fetch і
// жодного імпорту з ../ports чи ../app цієї ж картки -- реального HTTP-
// транспорту в репозиторії ще нема (framework-agnostic ports/*.ts, підключить
// майбутня T30). `loadCard`/`onRename` -- ін'єктовані проп-функції, що
// повертають Promise, той самий стиль DI, що вже в ../app/*.ts (callClaude,
// closeStructurePosition як опційні параметри use-case). Компонент сам керує
// локальним станом (loading/error/editing) навколо їхніх викликів.
//
// ISS-41 (DoD дескоуплено, docs/ISSUES.md): буквальний DoD T37 вимагав
// перевірити запис у Літопис Структури (structure AC-15) -- сервіс не існує
// жодним рядком коду (ISS-28), тому тест і код нижче цього НЕ роблять.
import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Spinner, TextField } from '../../../shared/ui';
import { ArchiveCardDialog } from './ArchiveCardDialog';
import { patchIfLoaded } from './state-utils';
import type { CardFaceData } from './types';
import type { CardHealthState } from '../domain/card';

// CH-02 (docs/features/life-area-card/changes.md): той самий патерн, що
// EntryHistoryList.tsx's STATUS_DOT/chip-gloss (D-120/D-126) -- готовий
// дискретний стан (не вигаданий поріг), тому дозволено той самий світлофор.
const HEALTH_STATE_DOT: Record<CardHealthState, string> = {
  active: 'bg-good',
  critical: 'bg-bad',
  paused: 'bg-warn',
};

const HEALTH_STATE_LABEL: Record<CardHealthState, string> = {
  active: 'використовується',
  critical: 'критично потребує відновлення',
  paused: 'на паузі',
};

export interface CardFaceProps {
  /** Завантажує дані лицьової сторони картки. */
  loadCard: () => Promise<CardFaceData>;
  /** Перегорнути картку на зворот (SCR-03). */
  onFlip: () => void;
  /**
   * Зберігає нову назву картки (AC-19, PATCH /cards/{id} name -- T21,
   * контракт уже готовий). Викликається лише з "Зберегти" в стані "editing";
   * "На зад" відкидає чернетку без цього виклику.
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
   * Review 2026-09-07 C10 (AC-03): зберігає Опис і похідну ознаку
   * "заповнена" (PATCH /cards/{id} description/markFilled -- update-card.ts,
   * контракт уже готовий). Опційний, як onCreateMetricBlock в CardBack --
   * відсутній, поле Опису в формі редагування не рендериться.
   */
  onUpdateDescription?: (input: { description: string; markFilled: boolean }) => Promise<void>;
}

type LoadState = 'loading' | 'ready' | 'error';

const FALLBACK_ERROR_TEXT = 'Не вдалося завантажити картку';
const SAVE_FAILED_MESSAGE = 'Не вдалося зберегти. Перевірте зв’язок і спробуйте ще раз.';

export function CardFace({ loadCard, onFlip, onRename, onArchive, onArchived, onUpdateDescription }: CardFaceProps): JSX.Element {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<CardFaceData | null>(null);
  const [error, setError] = useState<string>(FALLBACK_ERROR_TEXT);

  // Меню "..." і стан "editing" -- незалежні від loading/ready/error вище:
  // редагування можливе лише коли картка вже завантажена (ready), тому
  // isMenuOpen/isEditing скидаються при кожному новому loadCard (ефект нижче).
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  // ISS-56: другий пункт меню "..." -- "Архівувати" відкриває ArchiveCardDialog
  // (T29, фіксований контракт cardName/onArchive/onCancel). isArchiving --
  // незалежний від isEditing (обидва скидаються разом при новому loadCard).
  const [isArchiving, setIsArchiving] = useState(false);
  // code-review 2026-09-21 (conventions): click-outside-close для меню
  // "..." -- той самий підхід, що вже є на шестерні верхнього бару
  // (App.tsx, задача 9) і на звороті картки (CardBack.tsx).
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    function handleClickOutside(event: MouseEvent): void {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (menuButtonRef.current?.contains(target)) return;
      setIsMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    // Реально скидаємо (не лише коментарем обіцяємо) -- інакше відкрите меню
    // чи чернетка редагування зі старої картки лишились би поверх нових
    // даних, якщо loadCard проп зміниться (наприклад, батько перемкнув
    // картку) під час відкритого меню чи режиму редагування.
    setIsMenuOpen(false);
    setIsEditing(false);
    setDraftName('');
    setDraftDescription('');
    setIsSaving(false);
    setSaveError(undefined);
    setIsArchiving(false);

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

  function startEdit(): void {
    if (!data) return;
    setDraftName(data.name);
    setDraftDescription(data.description ?? '');
    setSaveError(undefined);
    setIsMenuOpen(false);
    setIsEditing(true);
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

  function cancelEdit(): void {
    // CH-06: "На зад" відкидає чернетку -- ні onRename, ні onUpdateDescription НІКОЛИ не викликаються тут.
    setIsEditing(false);
    setSaveError(undefined);
  }

  function saveEdit(): void {
    // Той самий guard, що startEdit -- саveEdit насправді недосяжний без
    // data (форма редагування рендериться лише коли state === 'ready'), але
    // TS не пронесе це звуження крізь окрему функцію без явної перевірки тут.
    if (!data) return;
    setSaveError(undefined);
    setIsSaving(true);

    // Review-fix (CH-06): onRename викликаємо ЛИШЕ якщо назва реально
    // змінилась -- раніше форма слала PATCH навіть коли користувач правив
    // тільки Опис, назва лишалась тою самою. Зайвий запит сам по собі не
    // ламав нічого напряму, але DeckScreen.tsx's handleRename (CH-07) на
    // кожен успішний onRename оновлює кеш колоди -- зайвий виклик тут
    // означав зайву (хай і тепер безпечну) роботу на рівень вище без причини.
    const nameChanged = draftName !== data.name;
    const renamePromise = nameChanged ? onRename(draftName) : Promise.resolve();
    // code-review 2026-09-21 (correctness): той самий guard, що nameChanged
    // вище -- без нього кожне збереження (навіть суто заради виправлення
    // назви) повторно слало Опис на сервер, і `null` ("опис ще не
    // заповнений") мовчки перетворювався на порожній рядок.
    const descriptionChanged = draftDescription !== (data.description ?? '');

    renamePromise
      .then(() => {
        // Review-fix (CH-06): застосовуємо УСПІШНЕ перейменування одразу,
        // не чекаючи опису нижче -- інакше onRename ОК + onUpdateDescription
        // reject показував би повний провал, хоча назва вже реально
        // змінилась на бекенді (data.name лишався б застарілим).
        if (nameChanged) {
          patchIfLoaded(setData, { name: draftName });
        }
        // TODO(ISS-28): коли зʼявиться сервіс Літопису Структури (structure
        // AC-15), тут піде виклик запису події перейменування. Сервіс ще не
        // існує жодним рядком коду -- виклику навмисно немає (ISS-41).
        if (!onUpdateDescription || !descriptionChanged) return undefined;
        // CH-06: "заповнена" -- похідне від тексту, не окремий чекбокс:
        // непорожній збережений Опис і Є ознакою заповненості.
        return onUpdateDescription({ description: draftDescription, markFilled: draftDescription.trim() !== '' }).then(() => {
          patchIfLoaded(setData, { description: draftDescription });
        });
      })
      .then(() => {
        setIsSaving(false);
        setIsEditing(false);
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : SAVE_FAILED_MESSAGE);
        setIsSaving(false);
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
    // Живе тестування (Андрій, баг 2): скрол і кнопка "перегорнути" -- на
    // РІЗНИХ рівнях (CardShell.tsx більше не скролить сам себе). Внутрішня
    // обгортка нижче (flex-1 min-h-0 overflow-y-auto) несе ввесь контент,
    // КРІМ кнопки -- САМЕ вона скролиться, якщо контенту забагато. Кнопка --
    // сестринський елемент ПІСЛЯ обгортки, природно лишається внизу (flex-1
    // забирає решту висоти в сусіда), mt-auto їй більше не потрібен.
    //
    // `relative` -- точка відліку для CH-02's м'ячик стану (absolute, правий
    // верхній кут КАРТКИ, не лише рядка заголовка).
    <div className="relative flex h-full flex-col gap-4">
      {data.trackingMode === 'state' && data.healthState && (
        <span
          aria-label={`Стан картки: ${HEALTH_STATE_LABEL[data.healthState]}`}
          title={HEALTH_STATE_LABEL[data.healthState]}
          className={`chip-gloss absolute -right-1 -top-1 h-3 w-3 shrink-0 rounded-full ${HEALTH_STATE_DOT[data.healthState]}`}
        />
      )}
      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto">
        {isEditing ? (
          <div className="flex flex-col gap-3">
            <TextField label="Назва" value={draftName} onChange={setDraftName} />
            {onUpdateDescription && (
              <TextField label="Опис (навіщо)" value={draftDescription} onChange={setDraftDescription} />
            )}
            <div className="flex justify-end gap-3">
              <Button label="На зад" onClick={cancelEdit} disabled={isSaving} />
              <Button label="Зберегти" onClick={saveEdit} disabled={isSaving} />
            </div>
            {saveError && <Banner variant="error" text={saveError} />}
          </div>
        ) : (
          <>
            {/* CH-05/AC-19: "торкається назви АБО обирає «Редагувати» в меню" --
                обидва входи ведуть у той самий startEdit. */}
            <div className="relative flex items-start justify-between gap-3">
              <h2 onClick={startEdit} className="cursor-pointer font-display text-xl font-bold leading-relaxed text-ink">
                {data.name}
              </h2>
              {/* `contents` -- div існує лише як носій ref для click-outside
                  (той самий трюк, що App.tsx, задача 9), не бере участі в
                  розкладці. */}
              <div ref={menuButtonRef} className="contents">
                <button
                  type="button"
                  aria-label="Меню картки"
                  onClick={toggleMenu}
                  className="shrink-0 rounded-control px-2 py-1 text-lg font-bold leading-none text-ink-muted transition-colors hover:bg-border hover:text-ink"
                >
                  ...
                </button>
              </div>
              {isMenuOpen && (
                <div
                  ref={menuRef}
                  role="menu"
                  className="absolute right-0 top-full z-10 mt-1 flex w-44 flex-col gap-0.5 rounded-control border border-border bg-surface-solid p-1.5 shadow-soft"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={startEdit}
                    className="w-full rounded-control px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-border"
                  >
                    Редагувати
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

        {!isEditing &&
          (hasDescription ? (
            <p
              onClick={onUpdateDescription ? startEdit : undefined}
              className={`text-sm italic text-ink-muted${onUpdateDescription ? ' cursor-pointer' : ''}`}
            >
              {data.description}
            </p>
          ) : (
            <p
              onClick={onUpdateDescription ? startEdit : undefined}
              className={`text-sm italic text-ink-faint${onUpdateDescription ? ' cursor-pointer' : ''}`}
            >
              Опис ще не заповнено
            </p>
          ))}

        {/* AC-10: непорозв'язана суперечність у даних -- показуємо, не блокуючи
            решту картки. 'info', не 'error' -- агент лише пропонує розібратись
            разом, тон без вердикту (design-system.md, D-42/D-60). CH-17: під
            Описом, не над ним -- Опис лишається головним змістом картки. */}
        {data.dataWarning && <Banner variant="info" text={data.dataWarning} />}
      </div>

      {!isEditing && (
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
