// DeckGrid (T25) -- сітка тайлів колоди карток.
//
// Навмисно узагальнений компонент (ISS-46): нічого не знає про статус картки
// (активна / архівна) -- лише рендерить items тайлами й повідомляє про клік
// через onOpen(id). Яку саме колекцію показати (активні картки, SCR-01, чи
// архівні, SCR-07) вирішує виклик пропами items/onOpen, а не сам DeckGrid --
// тому майбутня задача T36 (режим "архів") зможе імпортувати цей самий
// компонент без переписування, лише передавши інший items/onOpen.
//
// Правило залежностей (plan/app/CLAUDE.md): presentation-примітив зі
// shared/ui (Button) -- жодного domain, жодного ports/app.

import { Button } from '../../../shared/ui';

export interface DeckGridItem {
  /** Ідентифікатор картки -- прокидається в onOpen при кліку на тайл. */
  id: string;
  /** Назва картки -- підпис тайла. */
  name: string;
}

export interface DeckGridProps {
  /** Картки для показу тайлами. Порожній масив -- відповідальність виклику (EmptyState), не DeckGrid. */
  items: DeckGridItem[];
  /** Викликається з id картки, коли користувач відкриває тайл. */
  onOpen: (id: string) => void;
}

export function DeckGrid({ items, onOpen }: DeckGridProps): JSX.Element {
  return (
    <div>
      {items.map((item) => (
        <Button key={item.id} label={item.name} onClick={() => onOpen(item.id)} />
      ))}
    </div>
  );
}
