// NOTE: Not run in CI - requires DEEPSEEK_API_KEY and live DB
import { INestApplication } from '@nestjs/common';
import * as path from 'path';
import request from 'supertest';
import {
  createTestApp,
  ensureTestTenant,
  loginAsTestTenantAdmin,
  cleanupTestTenant,
  postSse,
  SseEvent,
} from './test-helpers';

jest.setTimeout(300_000);

const SKIP = !process.env.DEEPSEEK_API_KEY;

describe('Agent e2e — AVC upload flow (#165)', () => {
  if (SKIP) {
    it.skip('skipped: DEEPSEEK_API_KEY not set', () => {});
    return;
  }

  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await ensureTestTenant(app);
    token = await loginAsTestTenantAdmin(app);
  });

  afterAll(async () => {
    await cleanupTestTenant(app);
    await app.close();
  });

  it('uploads AVC xlsx, agent calls read_file_preview → preview_import_file → action_proposal, confirm completes', async () => {
    // 1. Upload fixture file
    const uploadRes = await request(app.getHttpServer())
      .post('/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', path.join(__dirname, 'fixtures/avc-sample.xlsx'));

    expect(uploadRes.status).toBe(201);
    const { fileId } = uploadRes.body as { fileId: string };
    expect(typeof fileId).toBe('string');

    // 2. Send chat message on 'research' surface
    const events = await postSse(
      app,
      '/agent/chat',
      {
        message: `帮我导入这个 AVC 文件，fileId 是 ${fileId}，导入到 market_metric 对象类型`,
        surface: 'research',
      },
      token,
      240_000,
    );

    const types = events.map((e) => e.type);

    // 3. Assert read_file_preview tool call
    expect(events.some((e) => e.type === 'tool_call' && (e as any).name === 'read_file_preview')).toBe(true);

    // 4. Assert preview_import_file tool call with multiply(10000) transform
    const previewCall = events.find(
      (e) => e.type === 'tool_call' && (e as any).name === 'preview_import_file',
    ) as SseEvent | undefined;
    expect(previewCall).toBeDefined();
    const previewArgs =
      typeof (previewCall as any)?.arguments === 'string'
        ? JSON.parse((previewCall as any).arguments)
        : ((previewCall as any)?.arguments ?? (previewCall as any)?.args ?? {});
    const transforms: unknown[] = previewArgs?.transforms ?? [];
    const hasMultiply = JSON.stringify(transforms).includes('multiply') ||
      JSON.stringify(transforms).includes('10000');
    expect(hasMultiply).toBe(true);

    // 5. Assert action_proposal event with actionId
    const proposal = events.find((e) => e.type === 'action_proposal') as any;
    expect(proposal).toBeDefined();
    const actionId: string = proposal?.actionId ?? proposal?.id;
    expect(typeof actionId).toBe('string');

    // 6. Confirm the action
    const confirmRes = await request(app.getHttpServer())
      .post(`/actions/${actionId}/confirm`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 201]).toContain(confirmRes.status);

    // 7. Poll for completion (max 60s)
    const deadline = Date.now() + 60_000;
    let finalStatus: string | undefined;
    while (Date.now() < deadline) {
      const statusRes = await request(app.getHttpServer())
        .get(`/actions/${actionId}/status`)
        .set('Authorization', `Bearer ${token}`);
      finalStatus = statusRes.body?.status;
      if (finalStatus === 'completed' || finalStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    expect(finalStatus).toBe('completed');
  });
});
