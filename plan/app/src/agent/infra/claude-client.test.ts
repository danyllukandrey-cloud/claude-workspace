// T12 (agent/infra/claude-client.ts) -- обгортка над Claude Messages API
// (Anthropic): request/response round-trip для тексту (AC-01), вкладення-фото
// (AC-10) і вкладення документ/таблиця (AC-19), відмова на непідтримуваному
// форматі (AC-19b) -- sad.md §5/§6 Critical flow 1/2/3.
//
// "Заглушка Claude endpoint" (DoD) -- реальний http.createServer на
// ефемерному порту (127.0.0.1), той самий підхід, що вже в server/app.test.ts
// (RED-коментар T30) -- справжній HTTP round-trip, без мережі назовні й без
// БД/.env, тож лишається у швидкому unit-прогоні (vite.config.ts виключає
// лише *.integration.test.ts, не цей файл).
//
// Ключ ніколи не логується (DoD): console.* шпигується протягом усього
// файлу -- жоден виклик (успіх чи відмова) не має містити сирий apiKey.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClaudeClient, isSupportedAttachment } from './claude-client';

const FAKE_API_KEY = 'sk-ant-t12-test-secret-do-not-log-me';

interface CapturedRequest {
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

async function startStubClaude(
  respond: (req: CapturedRequest) => { status: number; body: unknown }
): Promise<{ baseUrl: string; close: () => Promise<void>; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const captured: CapturedRequest = { headers: req.headers, body: raw.length > 0 ? JSON.parse(raw) : null };
      requests.push(captured);
      const { status, body } = respond(captured);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function claudeSuccessBody(text: string) {
  return { id: 'msg_stub', type: 'message', content: [{ type: 'text', text }] };
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {})
  );
});

afterEach(() => {
  for (const spy of consoleSpies) {
    // DoD: ключ ніколи не логується -- перевіряємо КОЖЕН виклик кожного console.*
    // метода за весь час теста (успіх і відмова обидва).
    for (const call of spy.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain(FAKE_API_KEY);
      }
    }
    spy.mockRestore();
  }
});

describe('createClaudeClient -- text round-trip (AC-01)', () => {
  it('надсилає текстовий content-блок і повертає розпізнаний текст відповіді', async () => {
    const proposalText = 'Пропоную записати: біг 5 км у картку "Здоров\'я".';
    const stub = await startStubClaude(() => ({ status: 200, body: claudeSuccessBody(proposalText) }));
    try {
      const askClaude = createClaudeClient({ apiKey: FAKE_API_KEY, baseUrl: stub.baseUrl });

      const result = await askClaude({ text: 'Пробіг 5 км сьогодні', attachment: null });

      expect(result).toEqual({ ok: true, value: proposalText });
      expect(stub.requests).toHaveLength(1);
      const [{ headers, body }] = stub.requests;
      expect(headers['x-api-key']).toBe(FAKE_API_KEY);
      expect(headers['anthropic-version']).toBeDefined();
      const sentContent = (body as { messages: Array<{ content: Array<{ type: string; text?: string }> }> }).messages[0]
        .content;
      expect(sentContent).toContainEqual({ type: 'text', text: 'Пробіг 5 км сьогодні' });
    } finally {
      await stub.close();
    }
  });

  it('додає системний промпт (правила + меню категорій, sad.md §4), коли переданий', async () => {
    const stub = await startStubClaude(() => ({ status: 200, body: claudeSuccessBody('ok') }));
    try {
      const askClaude = createClaudeClient({ apiKey: FAKE_API_KEY, baseUrl: stub.baseUrl });

      await askClaude({ text: 'привіт', attachment: null, systemPrompt: 'не радь, якщо не питаю' });

      const [{ body }] = stub.requests;
      expect((body as { system?: string }).system).toBe('не радь, якщо не питаю');
    } finally {
      await stub.close();
    }
  });
});

describe('createClaudeClient -- вкладення фото (AC-10)', () => {
  it('надсилає фото як image content-блок і повертає пропозицію на основі вкладення', async () => {
    const proposalText = 'Схоже на сторінку книги -- записати як "прочитано 20 сторінок"?';
    const stub = await startStubClaude(() => ({ status: 200, body: claudeSuccessBody(proposalText) }));
    try {
      const askClaude = createClaudeClient({ apiKey: FAKE_API_KEY, baseUrl: stub.baseUrl });

      const result = await askClaude({
        text: null,
        attachment: { mediaType: 'image/jpeg', base64Data: 'ZmFrZS1qcGVn' },
      });

      expect(result).toEqual({ ok: true, value: proposalText });
      const [{ body }] = stub.requests;
      const sentContent = (body as { messages: Array<{ content: Array<Record<string, unknown>> }> }).messages[0]
        .content;
      expect(sentContent).toContainEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'ZmFrZS1qcGVn' },
      });
    } finally {
      await stub.close();
    }
  });
});

describe('createClaudeClient -- вкладення документ/таблиця (AC-19)', () => {
  it('надсилає PDF-документ як document content-блок', async () => {
    const proposalText = 'У документі -- рахунок на 42.50, записати як витрату?';
    const stub = await startStubClaude(() => ({ status: 200, body: claudeSuccessBody(proposalText) }));
    try {
      const askClaude = createClaudeClient({ apiKey: FAKE_API_KEY, baseUrl: stub.baseUrl });

      const result = await askClaude({
        text: null,
        attachment: { mediaType: 'application/pdf', base64Data: 'ZmFrZS1wZGY=' },
      });

      expect(result).toEqual({ ok: true, value: proposalText });
      const [{ body }] = stub.requests;
      const sentContent = (body as { messages: Array<{ content: Array<Record<string, unknown>> }> }).messages[0]
        .content;
      expect(sentContent).toContainEqual({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: 'ZmFrZS1wZGY=' },
      });
    } finally {
      await stub.close();
    }
  });

  it('надсилає spreadsheet (.xlsx) як document content-блок так само, як PDF -- AC-19 "так само, як фото"', async () => {
    const proposalText = 'У таблиці -- 3 рядки витрат за тиждень, записати підсумок?';
    const stub = await startStubClaude(() => ({ status: 200, body: claudeSuccessBody(proposalText) }));
    try {
      const askClaude = createClaudeClient({ apiKey: FAKE_API_KEY, baseUrl: stub.baseUrl });
      const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      const result = await askClaude({
        text: null,
        attachment: { mediaType: xlsxType, base64Data: 'ZmFrZS14bHN4' },
      });

      expect(result).toEqual({ ok: true, value: proposalText });
      const [{ body }] = stub.requests;
      const sentContent = (body as { messages: Array<{ content: Array<Record<string, unknown>> }> }).messages[0]
        .content;
      expect(sentContent).toContainEqual({
        type: 'document',
        source: { type: 'base64', media_type: xlsxType, data: 'ZmFrZS14bHN4' },
      });
    } finally {
      await stub.close();
    }
  });
});

describe('createClaudeClient -- непідтримуваний формат вкладення (AC-19b, симетрично AC-10b)', () => {
  it('повертає Err без жодного мережевого виклику для архіву (.zip)', async () => {
    const stub = await startStubClaude(() => ({ status: 200, body: claudeSuccessBody('не мало сюди дійти') }));
    try {
      const askClaude = createClaudeClient({ apiKey: FAKE_API_KEY, baseUrl: stub.baseUrl });

      const result = await askClaude({
        text: null,
        attachment: { mediaType: 'application/zip', base64Data: 'ZmFrZS16aXA=' },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('claude.unsupported_attachment');
      }
      expect(stub.requests).toHaveLength(0);
    } finally {
      await stub.close();
    }
  });

  it('isSupportedAttachment розрізняє підтримувані і непідтримувані типи', () => {
    expect(isSupportedAttachment('image/jpeg')).toBe(true);
    expect(isSupportedAttachment('application/pdf')).toBe(true);
    expect(isSupportedAttachment('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(isSupportedAttachment('application/zip')).toBe(false);
    expect(isSupportedAttachment('application/x-msdownload')).toBe(false);
  });
});

describe('createClaudeClient -- Claude API недоступний (sad.md §6 Critical flow 2, domain-sentinel ADR-0006)', () => {
  it('повертає Err (не кидає виняток) на мережевий збій -- fetchImpl відхиляється', async () => {
    const failingFetch: typeof fetch = async () => {
      throw new Error('ECONNREFUSED -- симуляція мережевого збою');
    };
    const askClaude = createClaudeClient({ apiKey: FAKE_API_KEY, baseUrl: 'http://127.0.0.1:1', fetchImpl: failingFetch });

    const result = await askClaude({ text: 'привіт', attachment: null });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('claude.unavailable');
      expect(result.error.message).not.toContain(FAKE_API_KEY);
    }
  });

  it('повертає Err на не-2xx відповідь Claude API', async () => {
    const stub = await startStubClaude(() => ({ status: 500, body: { error: 'internal' } }));
    try {
      const askClaude = createClaudeClient({ apiKey: FAKE_API_KEY, baseUrl: stub.baseUrl });

      const result = await askClaude({ text: 'привіт', attachment: null });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('claude.unavailable');
      }
    } finally {
      await stub.close();
    }
  });

  it('повертає Err на неочікувану форму відповіді (без content[0].text)', async () => {
    const stub = await startStubClaude(() => ({ status: 200, body: { content: [] } }));
    try {
      const askClaude = createClaudeClient({ apiKey: FAKE_API_KEY, baseUrl: stub.baseUrl });

      const result = await askClaude({ text: 'привіт', attachment: null });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('claude.unexpected_response');
      }
    } finally {
      await stub.close();
    }
  });
});
