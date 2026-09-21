// Передня картка колоди -- ПОВНИЙ CardShell (лицьова/зворот) на місці, без
// окремого екрана "відкрити картку" (D-121, живе тестування: "Картка в
// колоді має одразу бути готова так ніби вона відкрита, і перевертатись на
// протилежний бік також"). Раніше цю композицію ніс окремий CardDetailScreen
// (ISS-55) -- прибраний разом із цією зміною; App.tsx більше не має стану
// 'detail', DeckGrid рендерить цей компонент прямо для передньої картки
// (DeckGrid.tsx, `renderFront`).
//
// Ключується по cardId у DeckGrid (`key={item.id}` на батьківському елементі
// шару) -- React сам ремонтує цей компонент при зміні передньої картки, тож
// `side` (лицьова/зворот) щоразу стартує заново з 'face' без явного ефекту
// скидання (той самий трюк, що React docs "resetting state with a key").
//
// ISS-45/DI (plan/app/CLAUDE.md "Правило залежностей"): жодного fetch тут --
// loadCard/loadBack і опційні дії -- ін'єктовані пропи-функції, ЗВ'ЯЗАНІ з
// cardId (той самий контракт, що AppProps уже визначає -- App.tsx раніше сам
// прив'язував screen.cardId, тепер це робить цей компонент).
import { useCallback, useState } from 'react';
import { CardShell } from '../../../shared/ui';
import { CardBack } from './CardBack';
import { CardFace } from './CardFace';
import type { MetricBlockFormValues } from './MetricBlockForm';
import type { CardBackData, CardFaceData, MetricBlockTransferTargetCard } from './types';
import type { CardTrackingMode, CardHealthState } from '../domain/card';

export interface DeckFrontCardProps {
  cardId: string;
  /**
   * CH-07 (docs/features/life-area-card/changes.md): назва картки -- потрібна
   * ЗАРАНІШЕ, ніж CardBack сам щось завантажить (ArchiveCardDialog з меню
   * звороту підставляє її в текст підтвердження). DeckScreen.tsx уже тримає
   * її в DeckGridItem.name -- жодного нового мережевого виклику не треба.
   */
  cardName: string;
  /** Завантажує дані лицьової сторони цієї картки. */
  loadCard: (cardId: string) => Promise<CardFaceData>;
  /** Завантажує дані звороту цієї картки. */
  loadBack: (cardId: string) => Promise<CardBackData>;
  /** Зберігає нову назву картки (AC-19). */
  onRename: (cardId: string, name: string) => Promise<void>;
  /** ISS-56: підтверджує архівацію картки. */
  onArchive: (cardId: string) => Promise<void>;
  /**
   * ISS-56 (перенесено з App.tsx): картку архівовано -- раніше сигнал ішов
   * "іди до Колоди" (окремий екран зникав сам собою); тепер картки й так
   * немає куди "йти" -- сигнал переадресовано батькові (DeckScreen) як
   * "перезавантаж колоду", щойно заархівована картка зникає зі стосу.
   */
  onArchived: () => void;
  /** Review C10 (AC-03): зберігає Опис/markFilled -- опційно, як і в CardFace. */
  onUpdateDescription?: (cardId: string, input: { description: string; markFilled: boolean }) => Promise<void>;
  /** AC-12: позначити запис історії помилковим -- опційно, як і в CardBack. */
  onFlagEntry?: (cardId: string, entryId: string) => Promise<CardBackData>;
  /** ISS-60: створює новий блок-метрику -- опційно, як і в CardBack. */
  onCreateMetricBlock?: (cardId: string, values: MetricBlockFormValues) => Promise<void>;
  /** Видаляє (архівує) блок-метрику -- опційно, як і в CardBack. */
  onArchiveMetricBlock?: (cardId: string, metricBlockId: string) => Promise<void>;
  /** CH-16: швидкий запис (додати/відняти) прямо з картки -- опційно, як і в CardBack. */
  onCreateEntry?: (cardId: string, metricBlockId: string, amount: number) => Promise<{ status: 'pending' | 'confirmed' }>;
  /** CH-02: зберігає режим відстеження картки -- опційно, як і в CardBack. */
  onUpdateTracking?: (cardId: string, input: { trackingMode: CardTrackingMode; healthState: CardHealthState | null }) => Promise<void>;
  /** CH-03: зберігає перейменування/налаштування блоку-метрики -- опційно, як і в CardBack. */
  onUpdateMetricBlock?: (cardId: string, metricBlockId: string, values: MetricBlockFormValues) => Promise<void>;
  /** CH-03: переносить блок-метрику на іншу картку -- опційно, як і в CardBack. */
  onTransferMetricBlock?: (cardId: string, metricBlockId: string, targetCardId: string) => Promise<void>;
  /** CH-03: картки-цілі для пікера перенесення -- DeckScreen.tsx вже фільтрує поточну картку. */
  transferTargetCards?: MetricBlockTransferTargetCard[];
}

type Side = 'face' | 'back';

export function DeckFrontCard({
  cardId,
  cardName,
  loadCard,
  loadBack,
  onRename,
  onArchive,
  onArchived,
  onUpdateDescription,
  onFlagEntry,
  onCreateMetricBlock,
  onArchiveMetricBlock,
  onCreateEntry,
  onUpdateTracking,
  onUpdateMetricBlock,
  onTransferMetricBlock,
  transferTargetCards,
}: DeckFrontCardProps): JSX.Element {
  const [side, setSide] = useState<Side>('face');

  // Референційна стабільність (Review 2026-09-07 E, той самий контракт, що
  // App.tsx раніше тримав для CardDetailScreen -- loadCardForDetail/
  // loadBackForDetail) -- CardFace/CardBack перезапускають свій
  // завантажувальний ефект на КОЖНУ зміну посилання loadCard/loadBack, тож
  // нестабільна функція (нова лямбда щорендера) спричинила б зайві запити.
  const loadFrontCard = useCallback(() => loadCard(cardId), [cardId, loadCard]);
  const loadFrontBack = useCallback(() => loadBack(cardId), [cardId, loadBack]);

  return (
    <CardShell
      isFlipped={side === 'back'}
      front={
        <CardFace
          loadCard={loadFrontCard}
          onFlip={() => setSide('back')}
          onRename={(name) => onRename(cardId, name)}
          onArchive={() => onArchive(cardId)}
          onArchived={onArchived}
          onUpdateDescription={onUpdateDescription ? (input) => onUpdateDescription(cardId, input) : undefined}
        />
      }
      back={
        <CardBack
          cardName={cardName}
          loadBack={loadFrontBack}
          onFlip={() => setSide('face')}
          onFlagEntry={onFlagEntry ? (entryId) => onFlagEntry(cardId, entryId) : undefined}
          onCreateMetricBlock={onCreateMetricBlock ? (values) => onCreateMetricBlock(cardId, values) : undefined}
          onArchiveMetricBlock={onArchiveMetricBlock ? (metricBlockId) => onArchiveMetricBlock(cardId, metricBlockId) : undefined}
          onCreateEntry={onCreateEntry ? (metricBlockId, amount) => onCreateEntry(cardId, metricBlockId, amount) : undefined}
          onUpdateTracking={onUpdateTracking ? (input) => onUpdateTracking(cardId, input) : undefined}
          onUpdateMetricBlock={onUpdateMetricBlock ? (metricBlockId, values) => onUpdateMetricBlock(cardId, metricBlockId, values) : undefined}
          onTransferMetricBlock={onTransferMetricBlock ? (metricBlockId, targetCardId) => onTransferMetricBlock(cardId, metricBlockId, targetCardId) : undefined}
          transferTargetCards={transferTargetCards}
          onArchive={() => onArchive(cardId)}
          onArchived={onArchived}
        />
      }
    />
  );
}
