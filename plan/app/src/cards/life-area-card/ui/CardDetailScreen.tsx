// SCR-02 + SCR-03 -- екран деталей картки (ISS-55 stage 2/3, docs/ISSUES.md):
// композиція CardFace (лицьова, T26) і CardBack (зворот, T26), обидва вже
// написані й протестовані ІЗОЛЬОВАНО зі своїми фіксованими контрактами
// (loadCard/onFlip/onRename на CardFace; loadBack/onFlip/onFlagEntry?/
// onRenameTransferredBlock? на CardBack) -- жоден із них не знає про "назад
// до Колоди", тому цей шар додає власний стан "яка сторона показана" і
// власну кнопку повернення, спільну для обох сторін.
//
// ISS-45/DI (plan/app/CLAUDE.md "Правило залежностей"): жодного fetch тут --
// loadCard/loadBack/onRename і опційні onFlagEntry/onRenameTransferredBlock --
// ін'єктовані пропи-функції, той самий стиль DI, що CardFace/CardBack.
// Композиція лише перемикає локальний стан "face"/"back" і прокидає пропи
// далі без змін.
import { useState } from 'react';
import { Button } from '../../../shared/ui';
import { CardBack } from './CardBack';
import { CardFace } from './CardFace';
import type { MetricBlockFormValues } from './MetricBlockForm';
import type { CardBackData, CardFaceData } from './types';

export interface CardDetailScreenProps {
  /** Завантажує дані лицьової сторони картки (CardFace). */
  loadCard: () => Promise<CardFaceData>;
  /** Завантажує дані звороту картки (CardBack). */
  loadBack: () => Promise<CardBackData>;
  /** Зберігає нову назву картки (AC-19, CardFace.onRename). */
  onRename: (name: string) => Promise<void>;
  /** Повернення до Колоди -- поза цим екраном (DeckScreen). */
  onBack: () => void;
  /** AC-12: позначити запис із історії помилковим -- опційно (CardBack.onFlagEntry). */
  onFlagEntry?: (entryId: string) => Promise<CardBackData>;
  /** AC-15: підтвердити нову назву блоку при колізії перенесення -- опційно (CardBack.onRenameTransferredBlock). */
  onRenameTransferredBlock?: (input: { metricBlockId: string; newLabel: string }) => Promise<CardBackData>;
  /** ISS-56: підтверджує архівацію картки -- прокидається без змін у CardFace.onArchive. */
  onArchive: () => Promise<void>;
  /** ISS-56: сигнал угору -- картку архівовано (CardFace.onArchived), прокидається без змін. */
  onArchived: () => void;
  /** ISS-60: створює новий блок-метрику картки -- опційно, прокидається без змін у CardBack.onCreateMetricBlock. */
  onCreateMetricBlock?: (values: MetricBlockFormValues) => Promise<void>;
  /** ТИМЧАСОВО (D-110, docs/DECISIONS.md) -- вносить запис для блоку -- опційно, прокидається без змін у CardBack.onAddEntry. */
  onAddEntry?: (metricBlockId: string, amount: number) => Promise<void>;
}

type Side = 'face' | 'back';

export function CardDetailScreen({
  loadCard,
  loadBack,
  onRename,
  onBack,
  onFlagEntry,
  onRenameTransferredBlock,
  onArchive,
  onArchived,
  onCreateMetricBlock,
  onAddEntry,
}: CardDetailScreenProps): JSX.Element {
  const [side, setSide] = useState<Side>('face');

  return (
    <div>
      <Button label="← Назад" onClick={onBack} />
      {side === 'face' ? (
        <CardFace
          loadCard={loadCard}
          onFlip={() => setSide('back')}
          onRename={onRename}
          onArchive={onArchive}
          onArchived={onArchived}
        />
      ) : (
        <CardBack
          loadBack={loadBack}
          onFlip={() => setSide('face')}
          onFlagEntry={onFlagEntry}
          onRenameTransferredBlock={onRenameTransferredBlock}
          onCreateMetricBlock={onCreateMetricBlock}
          onAddEntry={onAddEntry}
        />
      )}
    </div>
  );
}
