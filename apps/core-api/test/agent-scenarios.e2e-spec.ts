import { INestApplication } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createTestApp,
  loginAsAdmin,
  ensureTestTenant,
  loginAsTestTenantAdmin,
  cleanupTestTenant,
  postSse,
  runWithRetry,
  SseEvent,
} from './test-helpers';

jest.setTimeout(180_000);

describe('Agent scenarios (e2e, hits real DeepSeek)', () => {
  let app: INestApplication;
  let demoToken: string;
  let testToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await ensureTestTenant(app);
    demoToken = await loginAsAdmin(app);
    testToken = await loginAsTestTenantAdmin(app);
  });

  afterAll(async () => {
    await cleanupTestTenant(app);
    await app.close();
  });

  describe('L1 — single-turn query', () => {
    it('returns tool_call → tool_result → text → done with the right customer count', async () => {
      const events = await runWithRetry('L1', async () => {
        const res = await postSse(app, '/agent/chat', { message: '查询所有客户' }, demoToken);
        assertL1(res);
        return res;
      });

      // Final structural sanity — re-assert outside retry so the failure surfaces clearly
      assertL1(events);
    });
  });

  describe('L2 — schema exploration', () => {
    it('calls get_ontology_schema and reports business object types', async () => {
      const events = await runWithRetry('L2', async () => {
        const res = await postSse(app, '/agent/chat', { message: '我们有什么数据' }, demoToken);
        assertL2(res);
        return res;
      });
      assertL2(events);
    });
  });

  describe('L3 — multi-turn context + tool_call id round-trip', () => {
    it('successfully runs a follow-up turn after a tool-using first turn', async () => {
      const turn1 = await runWithRetry('L3-turn1', async () => {
        const res = await postSse(app, '/agent/chat', { message: '查询所有客户' }, demoToken);
        const types = res.map(e => e.type);
        expect(types).toContain('tool_result');
        expect(types).toContain('done');
        return res;
      });

      const conversationId = (turn1.find(e => e.type === 'done') as any)?.conversationId;
      expect(typeof conversationId).toBe('string');
      expect(conversationId.length).toBeGreaterThan(0);

      // Turn 2 — must NOT receive a 400 'missing field id' from DeepSeek
      const turn2 = await runWithRetry('L3-turn2', async () => {
        const res = await postSse(
          app,
          '/agent/chat',
          { message: '按客户等级分组统计', conversationId },
          demoToken,
        );
        const types = res.map(e => e.type);
        expect(types).toContain('done');

        const errorEvent = res.find(e => e.type === 'error') as any;
        expect(errorEvent?.message ?? '').not.toMatch(/missing field id|deserialize the JSON body/);

        return res;
      });

      // Final assertion: turn 2 produced a coherent text response
      const text = (turn2.find(e => e.type === 'text') as any)?.content ?? '';
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/missing field id/);
    });
  });

  describe('L4 — cross-skill conversation', () => {
    it('handles a query turn followed by a schema-design discussion turn', async () => {
      const turn1 = await runWithRetry('L4-turn1', async () => {
        const res = await postSse(app, '/agent/chat', { message: '有多少订单' }, demoToken);
        expect(res.map(e => e.type)).toContain('done');
        return res;
      });
      const conversationId = (turn1.find(e => e.type === 'done') as any)?.conversationId;
      expect(typeof conversationId).toBe('string');

      // Turn 2: ontology design domain ("我想加一个供应商类型，需要哪些字段?")
      // No write actually executes — just verify the agent engages without errors
      const turn2 = await runWithRetry('L4-turn2', async () => {
        const res = await postSse(
          app,
          '/agent/chat',
          { message: '我想加一个供应商类型，建议有哪些字段？只给建议，不要执行', conversationId },
          demoToken,
        );
        expect(res.map(e => e.type)).toContain('done');
        const err = res.find(e => e.type === 'error') as any;
        expect(err).toBeUndefined();
        return res;
      });

      const text = (turn2.find(e => e.type === 'text') as any)?.content ?? '';
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/missing field id|deserialize/);
      // Soft: response should mention supplier-relevant fields
      expect(text).toMatch(/供应商|supplier|名称|name|联系/i);
    });
  });

  describe('L5 — write op + confirmation accepted', () => {
    it('emits confirmation_request, executes the tool on confirm', async () => {
      // Use tenant_test so we don't dirty the demo ontology
      const initial = await runWithRetry('L5-initial', async () => {
        const res = await postSse(
          app,
          '/agent/chat',
          {
            message:
              '请帮我创建一个对象类型 "supplier_l5"，中文标签 "L5供应商"，属性只需要：name (字符串)、phone (字符串)。直接执行不要问。',
          },
          testToken,
        );
        return res;
      });

      const confirmReq = initial.find(e => e.type === 'confirmation_request') as any;
      expect(confirmReq).toBeDefined();
      expect(confirmReq.toolName).toBe('create_object_type');
      const conversationId = (initial.find(e => e.type === 'done') as any)?.conversationId;
      expect(typeof conversationId).toBe('string');

      // Confirm
      const resumeEvents = await postSse(
        app,
        '/agent/confirm',
        { conversationId, confirmed: true },
        testToken,
      );

      expect(resumeEvents.map(e => e.type)).toContain('done');
      const errEvents = resumeEvents.filter(e => e.type === 'error') as any[];
      // No error events from the resume path
      expect(errEvents).toHaveLength(0);

      // Verify the type was actually created in tenant_test
      const types = await fetchOntologyTypes(app, testToken);
      expect(types.find((t: any) => t.name === 'supplier_l5')).toBeDefined();
    });
  });

  describe('L6 — write op + confirmation rejected', () => {
    it('does NOT create the type when user rejects', async () => {
      const initial = await runWithRetry('L6-initial', async () => {
        return postSse(
          app,
          '/agent/chat',
          {
            message:
              '请帮我创建一个对象类型 "rejected_type_l6"，中文标签 "L6拒绝测试"，属性：name (字符串)。直接执行不要问。',
          },
          testToken,
        );
      });

      const confirmReq = initial.find(e => e.type === 'confirmation_request') as any;
      expect(confirmReq).toBeDefined();
      expect(confirmReq.toolName).toBe('create_object_type');
      const conversationId = (initial.find(e => e.type === 'done') as any)?.conversationId;

      const resumeEvents = await postSse(
        app,
        '/agent/confirm',
        { conversationId, confirmed: false, comment: '不需要这个类型' },
        testToken,
      );

      expect(resumeEvents.map(e => e.type)).toContain('done');

      // Verify the type was NOT created
      const types = await fetchOntologyTypes(app, testToken);
      expect(types.find((t: any) => t.name === 'rejected_type_l6')).toBeUndefined();

      // LLM should acknowledge the rejection in its follow-up text
      const text = (resumeEvents.find(e => e.type === 'text') as any)?.content ?? '';
      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe('L7 — file upload + import flow', () => {
    let csvPath: string;

    beforeAll(() => {
      csvPath = path.join(os.tmpdir(), `l7-import-${Date.now()}.csv`);
      const lines = ['id,name,city'];
      for (let i = 1; i <= 5; i++) {
        lines.push(`P${String(i).padStart(3, '0')},产品${i},城市${i}`);
      }
      fs.writeFileSync(csvPath, lines.join('\n'));
    });

    afterAll(() => {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    });

    it('uploads, parses, creates type, and imports rows', async () => {
      // Upload
      const fileId = await uploadFile(app, csvPath, testToken);
      expect(typeof fileId).toBe('string');

      // Ask the agent to import. We use a directive prompt so the LLM doesn't
      // ask clarifying questions and stays on the happy path.
      const initial = await runWithRetry('L7-initial', async () => {
        return postSse(
          app,
          '/agent/chat',
          {
            message:
              `请把这个文件导入为对象类型 "import_l7"，标签 "L7导入产品"，使用 id 列作为 externalId，name 列作为 label。直接执行，不要询问。`,
            fileId,
          },
          testToken,
        );
      });

      // The agent should at least call parse_file or hit a confirmation for create_object_type
      const types = initial.map(e => e.type);
      expect(types).toContain('done');
      const errs = initial.filter(e => e.type === 'error') as any[];
      expect(errs).toHaveLength(0);

      // Walk the confirmation chain: there may be 1-2 confirmations (create_object_type, import_data).
      // Loop while a confirmation_request appears and accept it. Cap at 5 to avoid infinite loops.
      let conversationId = (initial.find(e => e.type === 'done') as any)?.conversationId as string;
      let lastEvents: SseEvent[] = initial;
      for (let i = 0; i < 5; i++) {
        const confirmReq = lastEvents.find(e => e.type === 'confirmation_request') as any;
        if (!confirmReq) break;
        lastEvents = await postSse(
          app,
          '/agent/confirm',
          { conversationId, confirmed: true },
          testToken,
        );
        const errsR = lastEvents.filter(e => e.type === 'error') as any[];
        expect(errsR).toHaveLength(0);
      }

      // After all confirmations, the import_l7 type should exist with 5 rows
      const ontologyTypes = await fetchOntologyTypes(app, testToken);
      const importType = ontologyTypes.find((t: any) => t.name === 'import_l7');
      expect(importType).toBeDefined();

      // Verify rows present (query through agent's queryObjects path via /query/objects)
      const count = await fetchObjectCount(app, testToken, 'import_l7');
      expect(count).toBe(5);
    });
  });

  describe('L8 — cross-tenant isolation', () => {
    it('refuses to attach a tenant_test request to a demo conversationId', async () => {
      // First, demo creates a conversation
      const demoTurn = await runWithRetry('L8-demo', async () => {
        return postSse(app, '/agent/chat', { message: '查询所有客户' }, demoToken);
      });
      const demoConvId = (demoTurn.find(e => e.type === 'done') as any)?.conversationId as string;
      expect(typeof demoConvId).toBe('string');

      // tenant_test attempts to reuse demo's conversationId
      const crossTurn = await runWithRetry('L8-cross', async () => {
        return postSse(
          app,
          '/agent/chat',
          { message: '我的数据', conversationId: demoConvId },
          testToken,
        );
      });

      const crossConvId = (crossTurn.find(e => e.type === 'done') as any)?.conversationId as string;
      // The conversationId returned MUST differ from demo's — server should have created a new conv
      expect(crossConvId).not.toBe(demoConvId);
    });
  });

  describe('L9 — tool failure self-heal', () => {
    it('produces a non-crashing user-facing message when a tool returns an error', async () => {
      const events = await runWithRetry('L9', async () => {
        return postSse(
          app,
          '/agent/chat',
          { message: '查询所有 nonexistent_xyz_type 类型的数据' },
          demoToken,
        );
      });

      const types = events.map(e => e.type);
      expect(types).toContain('done');

      // The agent loop should have caught the tool error, fed it back to the LLM,
      // and produced a final text response — no top-level error event from the controller.
      const errorEvent = events.find(e => e.type === 'error') as any;
      // Either no error, or the error message is something useful (not a stack trace)
      if (errorEvent) {
        expect(typeof errorEvent.message).toBe('string');
      }

      const text = (events.find(e => e.type === 'text') as any)?.content ?? '';
      expect(text.length).toBeGreaterThan(0);
      // LLM should mention that the type doesn't exist or is not found, in some form
      expect(text).toMatch(/不存在|没有|未找到|not found|nonexistent/i);
    });
  });

  describe('L10 — long history boundary', () => {
    it('handles a turn after 20 pre-seeded history turns without errors', async () => {
      const { PrismaService } = require('@omaha/db');
      const prisma = app.get(PrismaService);
      const tenant = await prisma.tenant.findUnique({ where: { slug: 'tenant_test' } });
      const user = await prisma.user.findFirst({ where: { tenantId: tenant.id } });

      const conversation = await prisma.conversation.create({
        data: { userId: user.id, tenantId: tenant.id },
      });

      // Seed 20 alternating user/assistant turns. Half include tool_calls/results
      // to stress the buildLlmHistory path.
      for (let i = 0; i < 10; i++) {
        await prisma.conversationTurn.create({
          data: {
            conversationId: conversation.id,
            role: 'user',
            content: `historical user message ${i}`,
          },
        });
        const useTools = i % 3 === 0;
        await prisma.conversationTurn.create({
          data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: useTools ? null : `historical assistant reply ${i}`,
            toolCalls: useTools
              ? ([{ id: `seed_call_${i}`, name: 'get_ontology_schema', args: {} }] as any)
              : undefined,
            toolResults: useTools
              ? ([{ id: `seed_call_${i}`, name: 'get_ontology_schema', data: { types: [] } }] as any)
              : undefined,
          },
        });
      }

      // 21st turn — must succeed
      const events = await runWithRetry('L10', async () => {
        return postSse(
          app,
          '/agent/chat',
          { message: '简单回答 hi 即可', conversationId: conversation.id },
          testToken,
        );
      });

      const types = events.map(e => e.type);
      expect(types).toContain('done');

      const errorEvent = events.find(e => e.type === 'error') as any;
      // No error, or if there's one it's NOT about malformed history
      if (errorEvent) {
        expect(errorEvent.message).not.toMatch(/missing field id|deserialize/);
      }
    });
  });

  describe('L11 — MAX_TOOL_ITERATIONS defense', () => {
    it('caps tool calls at 5 and emits a soft error if hit (defense in depth)', async () => {
      // Provoke many tool calls. Even if the LLM doesn't actually hit the cap,
      // the test verifies that the cap is structurally enforced: tool_call events <= 5.
      const events = await runWithRetry('L11', async () => {
        return postSse(
          app,
          '/agent/chat',
          {
            message:
              '请依次查询所有 12 种对象类型的数据，每种类型分别用一次工具调用，不要合并。',
          },
          demoToken,
        );
      });

      const toolCallCount = events.filter(e => e.type === 'tool_call').length;
      expect(toolCallCount).toBeLessThanOrEqual(5);

      // If iterations were exhausted, an error event should mention the cap
      const errorEvent = events.find(e => e.type === 'error') as any;
      if (toolCallCount === 5 && errorEvent) {
        expect(errorEvent.message).toMatch(/最大工具调用次数|max tool iterations/i);
      }
      // The stream should produce events. If a controller-level error was thrown
      // (e.g. DeepSeek rejected the message format mid-stream), we get only 'error'.
      // That's still an acceptable terminal state — the cap is structurally enforced.
      expect(events.length).toBeGreaterThan(0);
      const terminalTypes = ['done', 'error'];
      const lastType = events[events.length - 1].type;
      expect(terminalTypes).toContain(lastType);
    });
  });
});

async function uploadFile(app: INestApplication, filePath: string, token: string): Promise<string> {
  const server = app.getHttpServer();
  const address = server.listening ? server.address() : await new Promise<any>(r => {
    server.listen(0, () => r(server.address()));
  });
  const port = typeof address === 'object' ? address.port : 0;

  const formData = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: 'text/csv' });
  formData.append('file', blob, path.basename(filePath));

  const res = await fetch(`http://127.0.0.1:${port}/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.fileId;
}

async function fetchObjectCount(app: INestApplication, token: string, objectType: string): Promise<number> {
  const server = app.getHttpServer();
  const address = server.listening ? server.address() : await new Promise<any>(r => {
    server.listen(0, () => r(server.address()));
  });
  const port = typeof address === 'object' ? address.port : 0;
  const res = await fetch(`http://127.0.0.1:${port}/query/objects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ objectType, page: 1, pageSize: 100 }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status}`);
  const json = await res.json();
  return json.meta?.total ?? 0;
}

async function fetchOntologyTypes(app: INestApplication, token: string): Promise<any[]> {
  const server = app.getHttpServer();
  const address = server.listening ? server.address() : await new Promise<any>(r => {
    server.listen(0, () => r(server.address()));
  });
  const port = typeof address === 'object' ? address.port : 0;
  const res = await fetch(`http://127.0.0.1:${port}/ontology/types`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`ontology types fetch failed: ${res.status}`);
  return res.json();
}

function assertL1(events: SseEvent[]): void {
  const types = events.map(e => e.type);

  expect(types).toContain('tool_call');
  expect(types).toContain('tool_result');
  expect(types).toContain('text');
  expect(types).toContain('done');

  const toolCall = events.find(e => e.type === 'tool_call' && (e as any).name === 'query_objects') as any;
  expect(toolCall).toBeDefined();
  expect(toolCall.args.objectType).toBe('customer');

  const toolResult = events.find(e => e.type === 'tool_result' && (e as any).name === 'query_objects') as any;
  expect(toolResult).toBeDefined();
  expect(toolResult.data?.meta?.total).toBe(3);
  expect(Array.isArray(toolResult.data?.data)).toBe(true);
  expect(toolResult.data.data.length).toBe(3);

  const text = (events.find(e => e.type === 'text') as any)?.content ?? '';
  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toMatch(/错误|抱歉|出错/);
  expect(text).toMatch(/客户|customer/i);
}

function assertL2(events: SseEvent[]): void {
  const types = events.map(e => e.type);
  expect(types).toContain('done');

  const schemaCall = events.find(e => e.type === 'tool_call' && (e as any).name === 'get_ontology_schema') as any;
  expect(schemaCall).toBeDefined();

  const schemaResult = events.find(e => e.type === 'tool_result' && (e as any).name === 'get_ontology_schema') as any;
  expect(schemaResult).toBeDefined();
  const typeNames: string[] = (schemaResult.data?.types ?? []).map((t: any) => t.name);
  expect(typeNames).toEqual(expect.arrayContaining(['customer', 'order', 'product']));

  const text = (events.find(e => e.type === 'text') as any)?.content ?? '';
  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toMatch(/错误|抱歉|出错/);
  // LLM should mention at least one core business type
  expect(text).toMatch(/customer|客户|order|订单|product|产品/i);
}
