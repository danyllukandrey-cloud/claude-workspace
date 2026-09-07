// Контрактний тест (T30, ADR-0006 §Рішення п.3): "тест читає contracts/openapi.yaml і
// валідує ним тіла відповідей хендлерів" -- НЕ другий рукописний опис контракту (правило
// єдиного джерела), лише структурний звіряч над уже написаним openapi.yaml. Здешевлений
// підхід (без повного AJV JSON-Schema валідатора) -- достатній для масштабу one-person MVP
// (ADR-0006 §Рушії рішення, "переінженерія на цьому масштабі -- мінус, не плюс").
//
// Перевіряє: required-поля присутні, additionalProperties:false не порушено (жодного
// зайвого ключа поза схемою), enum-значення валідні. Те саме, що ручне рев'ю робило б
// "по контракту", тепер робить машина -- саме вимога ADR-0006, не повнота JSON Schema.
//
// db підроблений (vi.fn()), той самий підхід, що ports/*.test.ts -- реальні хендлери
// (card-handlers.ts/entry-handlers.ts), реальний openapi.yaml, підроблене лише з'єднання.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { listCards, createCard } from '../src/cards/life-area-card/ports/card-handlers';
import { listEntries } from '../src/cards/life-area-card/ports/entry-handlers';
import { AppError } from '../src/shared/errors';
import type { Db } from '../src/cards/life-area-card/infra/postgres-repo';

interface JsonSchema {
  type?: string | string[];
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  $ref?: string;
}

interface OpenApiDoc {
  components: { schemas: Record<string, JsonSchema> };
}

const OPENAPI_PATH = path.resolve(
  __dirname,
  '../../../docs/features/life-area-card/contracts/openapi.yaml'
);
const doc = load(fs.readFileSync(OPENAPI_PATH, 'utf-8')) as OpenApiDoc;

function resolveSchema(schema: JsonSchema): JsonSchema {
  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    const resolved = doc.components.schemas[name];
    if (!resolved) {
      throw new Error(`Схема ${schema.$ref} не знайдена в openapi.yaml`);
    }
    return resolved;
  }
  return schema;
}

/**
 * Мінімальний структурний валідатор -- НЕ повний JSON Schema (навмисно,
 * коментар вгорі файлу): перевіряє лише required/additionalProperties/enum/type,
 * рекурсивно для object/array. Досить, щоб зловити "хендлер повернув поле, якого
 * немає в контракті" чи "забув обов'язкове поле" -- найчастіший клас дрейфу.
 */
/** Чи JS-значення відповідає одному JSON Schema `type` (T51) -- 'object'/'array' тут лише для повноти switch, реальну перевірку їхньої форми робить properties/items-гілка нижче. */
function matchesJsonType(value: unknown, jsonType: string): boolean {
  switch (jsonType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    default:
      return true;
  }
}

function assertMatchesSchema(value: unknown, rawSchema: JsonSchema, pathLabel: string): void {
  const schema = resolveSchema(rawSchema);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : undefined;

  if (value === null) {
    if (types && !types.includes('null')) {
      throw new Error(`${pathLabel}: null не дозволений цією схемою (type: ${JSON.stringify(schema.type)})`);
    }
    return;
  }

  // Review 2026-09-07 (group D remainder, T51): раніше `type` звірявся ЛИШЕ
  // у null-гілці вище -- будь-яке НЕ-null "листове" значення (string/number/
  // integer/boolean без properties/items) проходило без жодної перевірки
  // типу взагалі. object/array тут теж покриті (типова помилка -- масив там,
  // де контракт документує object, чи навпаки), хоча їхню ВНУТРІШНЮ форму
  // все одно звіряє properties/items-гілка нижче.
  if (types) {
    const matchesAny = types.some((type) => matchesJsonType(value, type));
    expect(
      matchesAny,
      `${pathLabel}: тип значення (${typeof value}) не відповідає жодному з дозволених у контракті (type: ${JSON.stringify(schema.type)})`
    ).toBe(true);
  }

  if (schema.enum) {
    expect(schema.enum, `${pathLabel}: значення "${String(value)}" не входить у enum контракту`).toContain(value);
  }

  if (schema.properties) {
    expect(typeof value, `${pathLabel}: очікувався object`).toBe('object');
    const obj = value as Record<string, unknown>;

    for (const requiredKey of schema.required ?? []) {
      expect(Object.prototype.hasOwnProperty.call(obj, requiredKey), `${pathLabel}: бракує обов'язкового поля "${requiredKey}"`).toBe(
        true
      );
    }

    if (schema.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        expect(allowedKeys.has(key), `${pathLabel}: зайве поле "${key}", якого немає в openapi.yaml (additionalProperties: false)`).toBe(
          true
        );
      }
    }

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        assertMatchesSchema(obj[key], propSchema, `${pathLabel}.${key}`);
      }
    }
    return;
  }

  if (schema.items) {
    expect(Array.isArray(value), `${pathLabel}: очікувався array`).toBe(true);
    (value as unknown[]).forEach((item, index) => assertMatchesSchema(item, schema.items as JsonSchema, `${pathLabel}[${index}]`));
  }
}

const OWNER = 'owner-contract-1';

function cardRow(overrides: Partial<{ id: string; name: string; description: string | null }> = {}) {
  return {
    id: overrides.id ?? 'card-contract-1',
    owner_user_id: OWNER,
    name: overrides.name ?? 'Спорт',
    description: overrides.description === undefined ? null : overrides.description,
    status: 'active' as const,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-02T00:00:00Z'),
  };
}

describe('contract test -- handler responses vs contracts/openapi.yaml (ADR-0006 §Рішення п.3)', () => {
  it('createCard response matches components.schemas.Card', async () => {
    const db: Db = { query: async () => ({ rows: [cardRow()] }) };

    const card = await createCard(db, OWNER, { name: 'Спорт' });

    assertMatchesSchema(card, { $ref: '#/components/schemas/Card' }, 'Card');
  });

  it('listCards response matches components.schemas.CardPage (items -> Card)', async () => {
    const db: Db = { query: async () => ({ rows: [cardRow({ id: 'card-a' }), cardRow({ id: 'card-b' })] }) };

    const page = await listCards(db, OWNER, {});

    assertMatchesSchema(page, { $ref: '#/components/schemas/CardPage' }, 'CardPage');
  });

  it('listEntries response matches components.schemas.EntryPage (items -> Entry)', async () => {
    const entryRow = {
      id: 'entry-1',
      metric_block_id: 'block-1',
      card_id: 'card-contract-1',
      amount: '5',
      raw_text: null,
      status: 'confirmed' as const,
      source_device_id: null,
      recorded_at: new Date('2026-01-01T00:00:00Z'),
      confirmed_at: new Date('2026-01-01T00:00:00Z'),
      created_at: new Date('2026-01-01T00:00:00Z'),
    };
    const db: Db = {
      query: async (text: string) => {
        if (text.includes('FROM card')) {
          return { rows: [cardRow({ id: 'card-contract-1' })] };
        }
        return { rows: [entryRow] };
      },
    };

    const page = await listEntries(db, OWNER, 'card-contract-1', {});

    assertMatchesSchema(page, { $ref: '#/components/schemas/EntryPage' }, 'EntryPage');
  });

  it('an AppError envelope matches components.schemas.Error', () => {
    const error = new AppError('card.not_found', 'Картку не знайдено', 404);

    assertMatchesSchema({ code: error.code, message: error.message }, { $ref: '#/components/schemas/Error' }, 'Error');
  });
});

// Review 2026-09-07 (group D remainder, T51): assertMatchesSchema перевіряв
// `type` ЛИШЕ в null-гілці (`if (value === null) { if (!types.includes('null')) throw }`)
// -- для будь-якого НЕ-null значення без `properties`/`items` (тобто "листового"
// значення -- string/number/integer/boolean) тип узагалі не звірявся. Хендлер,
// що повернув число там, де контракт документує string (чи навпаки), пройшов
// би цей тест мовчки -- сама мета контрактного тесту (шапка файлу) не
// виконувалась для найпростішого й найчастішого класу дрейфу.
describe('T51: assertMatchesSchema звіряє `type` для НЕ-null листових значень, не лише null-гілку', () => {
  it('відхиляє число там, де схема документує type: string', () => {
    expect(() => assertMatchesSchema(42, { type: 'string' }, 'field')).toThrow();
  });

  it('відхиляє рядок там, де схема документує type: boolean', () => {
    expect(() => assertMatchesSchema('true', { type: 'boolean' }, 'field')).toThrow();
  });

  it('відхиляє нецілий number там, де схема документує type: integer', () => {
    expect(() => assertMatchesSchema(1.5, { type: 'integer' }, 'field')).toThrow();
  });

  it('контрольний випадок -- не надто суворий: відповідні типи не кидають', () => {
    expect(() => assertMatchesSchema('Спорт', { type: 'string' }, 'field')).not.toThrow();
    expect(() => assertMatchesSchema(5, { type: 'integer' }, 'field')).not.toThrow();
    expect(() => assertMatchesSchema(true, { type: 'boolean' }, 'field')).not.toThrow();
  });
});
