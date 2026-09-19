// SCR-01 — Декларація (spec.md AC-09, AC-10).
//
// DI (plan/app/CLAUDE.md, той самий стиль, що CardDetailScreen/
// ArchiveCardDialog): loadStructure/onSave — ін'єктовані пропи-функції,
// жодного fetch() тут. Реальний HTTP-транспорт (ports/) підключає
// викликач цього компонента.
//
// Живе тестування (Андрій): екран має ДВА стани, не одну форму. VIEW
// (за замовчуванням) — текст декларації READ-ONLY, плаваюча кнопка знизу
// по центру "Змінити декларацію" (та сама, що вже плаває на AnalyticsScreen/
// App.tsx архівному екрані — "Архів"/"Звіт"/"Назад"). Клік перемикає на
// EDIT — той самий textarea, що був тут завжди, БЕЗ жодного налаштування
// розкладки (LAYOUT_MODE_OPTIONS переїхав цілком на LayoutBoard.tsx,
// "Конфігурація" — там і питання "де далі розкладати", не тут). У EDIT
// та сама кнопка (той самий підпис "Змінити декларацію") діє як "Зберегти":
// клік викликає onSave лише з полем declaration і повертає на VIEW зі
// свіжим текстом.
//
// ConfirmDialog/hasArrangedCards тут більше немає — той сценарій
// (AC-11/AC-11b) стосувався виключно зміни layoutMode, яка звідси пішла
// разом із пікером на LayoutBoard.tsx.
//
// Порожня декларація у VIEW — курсив (italic), той самий стиль, що вже є в
// застосунку для "Опис ще не заповнено" (CardFace.tsx) — "Тексту декларації
// поки немає".
//
// Save-failure discrimination (мірорить src/app/main.tsx): onSave, що
// падає з AppError-подібною помилкою (є code/httpStatus — сервер
// відповів), показує Banner variant="error" і ЛИШАЄ користувача в EDIT
// (значення не збереглось — виправляти є що). onSave, що падає зі звичайною
// Error (fetch сам не спрацював — офлайн), означає, що запис прийнято
// локально і синхронізується пізніше — Banner variant="info", і екран усе
// одно повертається на VIEW (той самий принцип, що спроба вважається
// прийнятою).

import { useEffect, useState } from 'react';
import { Banner, Button, Spinner } from '../../shared/ui';

export interface DeclarationScreenState {
  declaration: string | null;
}

export interface DeclarationScreenProps {
  /** Завантажує поточну декларацію. */
  loadStructure: () => Promise<DeclarationScreenState>;
  /** Зберігає новий текст декларації. Кидає AppError-подібну помилку (code/httpStatus), якщо відповів сервер, або звичайну Error при мережевому збої (офлайн). */
  onSave: (input: { declaration: string }) => Promise<void>;
}

interface AppErrorShape {
  message: string;
  code: unknown;
  httpStatus: unknown;
}

// Duck-typing замість `instanceof AppError` — тест (і реальний HTTP-шар
// портів) моделює "сервер відповів" будь-якою помилкою з полями
// code/httpStatus, не обов'язково класом shared/errors.
function isAppErrorShape(err: unknown): err is AppErrorShape {
  return typeof err === 'object' && err !== null && 'code' in err && 'httpStatus' in err;
}

type ScreenMode = 'view' | 'edit';

export function DeclarationScreen({ loadStructure, onSave }: DeclarationScreenProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ScreenMode>('view');
  const [declaration, setDeclaration] = useState('');
  const [banner, setBanner] = useState<{ variant: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    loadStructure().then((state) => {
      setDeclaration(state.declaration ?? '');
      setLoading(false);
    });
    // Навмисно без loadStructure у deps -- викликається рівно раз при монтуванні
    // (той самий підхід, що CardFace/CardBack: DI-функція стабільна для життя екрана).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <Spinner />;
  }

  const startEdit = (): void => {
    setBanner(null);
    setMode('edit');
  };

  const persist = async (): Promise<void> => {
    try {
      await onSave({ declaration });
      setBanner({ variant: 'success', text: 'Збережено' });
      setMode('view');
    } catch (err: unknown) {
      if (isAppErrorShape(err)) {
        // Значення не збереглось -- лишаємось в EDIT, є що виправляти й
        // повторити спробу.
        setBanner({ variant: 'error', text: err.message });
      } else {
        const message = err instanceof Error ? err.message : 'Не вдалося зберегти';
        setBanner({
          variant: 'info',
          text: `Немає з'єднання -- зміни збережено локально й будуть синхронізовані пізніше (офлайн). ${message}`,
        });
        setMode('view');
      }
    }
  };

  const handleButtonClick = (): void => {
    if (mode === 'view') {
      startEdit();
    } else {
      void persist();
    }
  };

  const hasDeclaration = declaration.trim().length > 0;

  // Живе тестування (Андрій): "цей формат по центру відноситься тільки до
  // системного тексту. Текст що буде введений має бути відформатований по
  // ліву сторону." -- вузька центрована колонка (max-w-md mx-auto) пасує
  // короткому системному повідомленню-заглушці, але виглядає "криво" для
  // РЕАЛЬНОГО тексту декларації -- той має читатись зліва направо на
  // ширшій колонці, як звичайний текст, а не тулитись по центру екрана.
  const isPlaceholder = mode === 'view' && !hasDeclaration;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        className={`flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 pb-20 ${
          isPlaceholder ? 'mx-auto w-full max-w-md items-center text-center' : 'mx-auto w-full max-w-2xl'
        }`}
      >
        {mode === 'view' ? (
          hasDeclaration ? (
            <p className="whitespace-pre-wrap text-left text-sm italic text-ink-muted">{declaration}</p>
          ) : (
            <p className="text-sm italic text-ink-faint">Тексту декларації поки немає</p>
          )
        ) : (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Картина світу, навіщо, пріоритет
            <textarea
              value={declaration}
              onChange={(event) => setDeclaration(event.target.value)}
              rows={5}
              className="min-h-32 resize-y rounded-control border border-border bg-surface-solid px-3.5 py-2.5 font-sans text-sm font-normal italic text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
            />
          </label>
        )}

        {banner !== null && <Banner variant={banner.variant} text={banner.text} />}
      </div>

      {/* Живе тестування (Андрій): "по середині" -- не зліва/справа, як
          Архів/Звіт/Назад в інших екранах цього ж застосунку -- тут навмисно
          left-1/2 -translate-x-1/2, той самий floating-патерн (absolute
          відносно кореневого relative-контейнера, поверх контенту, z-20). */}
      <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
        <Button label="Змінити декларацію" onClick={handleButtonClick} />
      </div>
    </div>
  );
}
