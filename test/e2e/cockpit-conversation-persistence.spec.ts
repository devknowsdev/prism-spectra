import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3900' });

type StoredMessage = {
  id: number;
  conversationId: number;
  role: string;
  provider: string | null;
  model: string | null;
  prompt: string | null;
  response: string | null;
  createdAt: string;
};

type StoredConversation = {
  id: number;
  title: string | null;
  createdAt: string;
  messages: StoredMessage[];
};

function conversationProjection(conversation: StoredConversation) {
  const updatedAt = conversation.messages.at(-1)?.createdAt || conversation.createdAt;
  return {
    id: conversation.id,
    title: conversation.title,
    label: conversation.title || `Conversation ${conversation.id}`,
    summary: conversation.messages.at(-1)?.prompt || null,
    metadata: { source: 'playwright' },
    createdAt: conversation.createdAt,
    updatedAt,
    messageCount: conversation.messages.length,
    attachmentCount: 0,
    relatedCheckpointId: null,
    relatedArtifactId: null,
  };
}

async function installConversationApi(page: Page) {
  const conversations = new Map<number, StoredConversation>();
  const aiRequests: Array<Record<string, any>> = [];
  let nextConversationId = 1;
  let nextMessageId = 1;

  await page.route('**/api/v1/workbench/conversations**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const detailMatch = requestUrl.pathname.match(/^\/api\/v1\/workbench\/conversations\/(\d+)$/);
    if (detailMatch) {
      const conversation = conversations.get(Number(detailMatch[1]));
      if (!conversation) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'conversation not found' }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conversation: {
            ...conversationProjection(conversation),
            messages: conversation.messages,
            attachments: [],
          },
        }),
      });
      return;
    }

    const items = [...conversations.values()]
      .sort((left, right) => right.id - left.id)
      .map(conversationProjection);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        conversations: {
          items,
          count: items.length,
          totalCount: items.length,
          emptyStateMessage: items.length === 0 ? 'No conversations are available yet.' : '',
        },
      }),
    });
  });

  await page.route('**/api/v1/conversations', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as { title?: unknown };
    const id = nextConversationId++;
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : null;
    conversations.set(id, {
      id,
      title,
      createdAt: `2026-07-13T12:00:0${id}.000Z`,
      messages: [],
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id, title }),
    });
  });

  await page.route('**/api/v1/conversations/*/messages', async (route) => {
    const match = new URL(route.request().url()).pathname.match(/^\/api\/v1\/conversations\/(\d+)\/messages$/);
    const conversationId = match ? Number(match[1]) : NaN;
    const conversation = conversations.get(conversationId);
    if (!conversation) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'conversation not found' }) });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const id = nextMessageId++;
    conversation.messages.push({
      id,
      conversationId,
      role: String(body.role || 'assistant'),
      provider: typeof body.provider === 'string' ? body.provider : null,
      model: typeof body.model === 'string' ? body.model : null,
      prompt: typeof body.prompt === 'string' ? body.prompt : null,
      response: typeof body.response === 'string' ? body.response : null,
      createdAt: `2026-07-13T12:10:0${id}.000Z`,
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id }) });
  });

  await page.route('**/api/v1/ai/request', async (route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    aiRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'ollama',
        model: 'qwen3.5:9b',
        dataBoundary: 'local',
        response: `Local answer for: ${body?.input?.prompt || ''}`,
        structuredResponse: null,
        provenance: { routedBy: 'prism-spectra' },
        usage: { tokensIn: 10, tokensOut: 20, cost: 0, latencyMs: 12 },
      }),
    });
  });

  return { conversations, aiRequests };
}

test('Workbench creates, selects, saves, reloads, and resumes one explicit local conversation', async ({ page }) => {
  const fixture = await installConversationApi(page);
  await page.goto('/workbench#console', { waitUntil: 'load' });

  const select = page.locator('#console-conversation-select');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('');
  await expect(page.locator('#console-conversation-mode')).toHaveText('one-shot');
  await expect(page.locator('#console-transcript')).toContainText('Select or create a conversation');

  await page.locator('#console-conversation-title').fill('F3b architecture');
  await page.locator('#console-conversation-create').click();
  await expect(select).toHaveValue('1');
  await expect(page).toHaveURL(/conversationId=1/);
  await expect(page.locator('#console-conversation-mode')).toContainText('persistent');

  await page.locator('#console-prompt').fill('Explain the next smallest safe slice.');
  await page.locator('#console-send').click();
  await expect(page.locator('#console-status')).toContainText('Response received');
  await expect(page.locator('#console-transcript')).toContainText('Explain the next smallest safe slice.');
  await expect(page.locator('#console-transcript')).toContainText('Local answer for: Explain the next smallest safe slice.');

  expect(fixture.aiRequests).toHaveLength(1);
  expect(fixture.aiRequests[0]).toMatchObject({
    sourceApp: 'prism-spectra',
    intent: 'workbench-chat',
    preferredMode: 'local-only',
    record: false,
  });
  expect(fixture.aiRequests[0].conversationId).toBeUndefined();
  expect(fixture.conversations.get(1)?.messages).toHaveLength(1);
  expect(fixture.conversations.get(1)?.messages[0]).toMatchObject({
    prompt: 'Explain the next smallest safe slice.',
    response: 'Local answer for: Explain the next smallest safe slice.',
    provider: 'ollama',
    model: 'qwen3.5:9b',
  });

  await page.reload({ waitUntil: 'load' });
  await expect(page).toHaveURL(/conversationId=1/);
  await expect(page.locator('#console-conversation-select')).toHaveValue('1');
  await expect(page.locator('#console-transcript')).toContainText('Explain the next smallest safe slice.');
  await expect(page.locator('#console-transcript')).toContainText('Local answer for: Explain the next smallest safe slice.');
});

test('Workbench keeps two explicit conversations isolated and leaves one-shot requests unsaved', async ({ page }) => {
  const fixture = await installConversationApi(page);
  await page.goto('/workbench#console', { waitUntil: 'load' });

  await page.locator('#console-prompt').fill('One-shot check.');
  await page.locator('#console-send').click();
  await expect(page.locator('#console-status')).toContainText('Response received');
  expect(fixture.aiRequests[0].record).toBeUndefined();
  expect(fixture.conversations.size).toBe(0);

  await page.locator('#console-conversation-title').fill('Conversation A');
  await page.locator('#console-conversation-create').click();
  await page.locator('#console-prompt').fill('Only in A');
  await page.locator('#console-send').click();
  await expect(page.locator('#console-transcript')).toContainText('Only in A');

  await page.locator('#console-conversation-title').fill('Conversation B');
  await page.locator('#console-conversation-create').click();
  await page.locator('#console-prompt').fill('Only in B');
  await page.locator('#console-send').click();
  await expect(page.locator('#console-transcript')).toContainText('Only in B');
  await expect(page.locator('#console-transcript')).not.toContainText('Only in A');

  await page.locator('#console-conversation-select').selectOption('1');
  await expect(page.locator('#console-transcript')).toContainText('Only in A');
  await expect(page.locator('#console-transcript')).not.toContainText('Only in B');
  expect(fixture.conversations.get(1)?.messages.map((message) => message.prompt)).toEqual(['Only in A']);
  expect(fixture.conversations.get(2)?.messages.map((message) => message.prompt)).toEqual(['Only in B']);
});
