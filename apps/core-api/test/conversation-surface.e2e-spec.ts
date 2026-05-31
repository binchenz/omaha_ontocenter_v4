import { INestApplication } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { ConversationService } from '../src/modules/conversation/conversation.service';
import { createTestApp, ensureTestTenant, cleanupTestTenant } from './test-helpers';

/**
 * #90 — Surface is a property of the Conversation, fixed at creation, not a live
 * reflection of the request (ADR-0041 §3). A Conversation created on surface X keeps
 * X for its whole lifetime even when a later message arrives carrying a different
 * surface, so the back end assembles Skills from a stable task context.
 */
describe('Conversation.surface (#90, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let conversations: ConversationService;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    conversations = app.get(ConversationService);
    tenantId = await ensureTestTenant(app);
    const user = await prisma.user.findFirst({ where: { tenantId } });
    userId = user!.id;
  });

  afterEach(async () => {
    await prisma.conversationTurn.deleteMany({ where: { conversation: { tenantId } } });
    await prisma.conversation.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await cleanupTestTenant(app);
    await app.close();
  });

  it('records the surface a Conversation is created on', async () => {
    const created = await conversations.getOrCreate(userId, tenantId, undefined, 'maintain');
    expect(created.surface).toBe('maintain');
  });

  it('keeps the creation surface when a later call carries a different surface', async () => {
    const created = await conversations.getOrCreate(userId, tenantId, undefined, 'maintain');

    // A later message on the same Conversation arrives on the consume surface...
    const reopened = await conversations.getOrCreate(userId, tenantId, created.id, 'consume');

    // ...but the Conversation's surface is unchanged — it is fixed at creation.
    expect(reopened.id).toBe(created.id);
    expect(reopened.surface).toBe('maintain');
  });
});
