// Поле вводу чату SCR-01 (T25) -- текст і/або вкладення (фото/документ),
// AC-01 (текст), AC-10/AC-19 (вкладення замінює текстовий опис повністю).
// `MessageCreate` у contracts/openapi.yaml дозволяє content=NULL коли є
// attachment, і навпаки -- та сама форма тут: обидва поля незалежно
// опційні, надіслати можна лише коли хоч одне не порожнє.
//
// Controlled, але зі внутрішнім чернетковим станом (текст/файл) -- той самий
// підхід, що TextField (значення контролює компонент, поки не надіслано);
// після onSend компонент сам скидає чернетку, викликач не повинен
// синхронізувати controlled value ззовні для цього.
//
// D-121 (docs/app-shell.md): значки замінюють видимий текстовий підпис поля
// й кнопку "Надіслати" -- той самий набір каналів, що Клод у власному
// застосунку (текст/вкладення/диктування), у межах уже підтверджених
// продуктом (D-41/D-54, docs/DECISIONS.md). Мікрофон -- НЕАКТИВНА заглушка:
// саме розпізнавання (браузер чи сервер) лишається відкритим питанням D-41,
// цей крок його не вирішує.
//
// Enter надсилає (D-121, живе тестування): рядок значків -- справжній
// <form>, кнопка "Надіслати" -- type="submit" (єдина в рядку; Прикріпити й
// Диктування лишаються type="button", IconButton-дефолт, тож не тригерять
// сабміт). Натискання Enter у TextField -- нативна поведінка браузера для
// текстового інпута всередині форми, жодного onKeyDown вручну не треба.
// Клік по кнопці "Надіслати" сам собою теж submit (не onClick) -- дублювати
// виклик handleSend в обох місцях означало б надіслати повідомлення двічі,
// бо onSend спрацював би раніше, ніж setText/setAttachment встигли скинути
// чернетку.
//
// Composer СКЛАДАЄТЬСЯ зі спільних примітивів shared/ui (Review 2026-09,
// finding 3): текстове поле -- TextField (hideLabel, D-121), кнопки --
// IconButton. Єдиний бере bare <input type="file"> -- для вкладення в repo
// ще нема спільного примітиву; тепер visually-hidden (sr-only) всередині
// <label> зі своїм sr-only підписом, замість голого браузерного контролу.

import { useState } from 'react';
import { AttachIcon, IconButton, MicIcon, SendIcon, TextField } from '../../../shared/ui';

export interface ComposerSendInput {
  /** NULL, якщо надіслано лише вкладення без тексту (AC-10). */
  content: string | null;
  /** NULL, якщо надіслано лише текст без вкладення (AC-01). */
  attachment: File | null;
}

export interface ComposerProps {
  /** Викликається з чернеткою при надсиланні; сам HTTP-запит (POST /messages) робить викликач. */
  onSend: (input: ComposerSendInput) => void;
  /** Композер недоступний, поки попереднє повідомлення в польоті. */
  disabled?: boolean;
}

export function Composer({ onSend, disabled = false }: ComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);

  const trimmed = text.trim();
  const canSend = trimmed !== '' || attachment !== null;

  const handleSend = (): void => {
    if (!canSend) return;
    onSend({
      content: trimmed === '' ? null : text,
      attachment,
    });
    setText('');
    setAttachment(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* Ім'я вибраного файла -- єдиний видимий слід вкладення (значок сам по собі не показує, що вже щось прикріплено). */}
      {attachment && <p className="truncate px-1 text-xs text-ink-muted">Вкладення: {attachment.name}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
        className="flex items-center gap-1.5 rounded-card border border-border bg-surface-solid p-1.5 shadow-soft"
      >
        {/* <label> що обгортає <input type=file> -- нативний клік по значку відкриває
            вибір файла без jsID-звʼязку; sr-only текст усередині лейбла -- те саме
            джерело accessible name, що TextField.hideLabel (не aria-hidden окремо
            від контролу -- лейбл і контрол лишаються ОДНИМ вузлом accessible-дерева). */}
        <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-border hover:text-ink">
          <span className="sr-only">Прикріпити фото</span>
          <AttachIcon className="h-5 w-5" />
          <input
            type="file"
            disabled={disabled}
            onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </label>

        {/* min-w-0 обов'язковий (D-121, живе тестування -- горизонтальний
            близнюк того самого min-h-0 фікса з App.tsx): без нього
            flex-дитина з текстовим <input> не стискається нижче свого
            природного min-content, і рядок композера продавлює вузьку 20%-
            колонку (широкий екран), змушуючи весь блок переписки горизонтально
            скролитись -- саме той баг, що показав скріншот. */}
        <div className="min-w-0 flex-1">
          <TextField label="Повідомлення" hideLabel value={text} onChange={setText} placeholder="напиши або додай фото" />
        </div>

        {/* Мікрофон -- заглушка (D-121, docs/app-shell.md): D-41 лишає відкритим, де виконується розпізнавання. */}
        <IconButton label="Диктування (скоро)" disabled>
          <MicIcon className="h-5 w-5" />
        </IconButton>

        <IconButton label="Надіслати" type="submit" disabled={disabled || !canSend}>
          <SendIcon className="h-5 w-5" />
        </IconButton>
      </form>
    </div>
  );
}
