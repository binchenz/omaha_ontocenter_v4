/**
 * Ontology Test Scenario Runners - Phase 1 Implementation
 *
 * Three execution strategies for ontology test cases:
 * 1. runSchemaScenario: Schema change verification (3-layer check: DB + SDK + Agent)
 * 2. runQueryScenario: Agent query verification (SSE + ground truth comparison)
 * 3. runAgentScenario: Multi-turn conversation testing (auto-confirm support)
 *
 * All runners:
 * - Wrap ephemeral tenant lifecycle via withEphemeralTenant HOF
 * - Capture telemetry (TTFB, latency, tool_calls, errors)
 * - Return ScenarioResult with verdict + telemetry
 *
 * Pattern sources:
 * - repro-rice-cooker-chat.ts: In-process orchestrator.run() pattern
 * - uat-chat-harness.ts: ChatSession for multi-turn + auto-confirm
 * - ephemeral-tenant.ts: withEphemeralTenant HOF
 */

import { PrismaService } from '@omaha/db';
import { OrchestratorService } from '../../src/modules/orchestrator/orchestrator.service';
import { OntologySdk } from '../../src/modules/ontology/ontology.sdk';
import type { CurrentUser } from '@omaha/shared-types';
import {
  OntologyTestCase,
  ScenarioResult,
  SetupContext,
  ExecuteContext,
  TelemetryData,
  TestVerdict,
} from './types';
import { withEphemeralTenant, EphemeralTenantContext } from '../../src/test-utils/ephemeral-tenant';

/**
 * Schema scenario: setup → execute schema change → verify 3 layers (DB, SDK, Agent)
 *
 * Verification layers:
 * 1. DB layer: Raw Prisma query confirms schema change persisted
 * 2. SDK layer: OntologySdk reflects the change (getSchemaSummary, etc.)
 * 3. Agent layer: Agent system prompt includes the change (typeNames, schemaSummary)
 *
 * @param prisma PrismaService instance
 * @param testCase Test case with setup/execute/verify phases
 * @returns ScenarioResult with 3-layer verdict + telemetry
 *
 * @example
 * ```ts
 * const result = await runSchemaScenario(prisma, {
 *   id: 'schema-001',
 *   title: 'Add derived field to market_metric',
 *   category: 'derived-field',
 *   track: 'integration',
 *   setup: async () => ({ tenantId, objectTypeIds: {...} }),
 *   execute: async (ctx) => {
 *     // Create derived field via API/SDK
 *     return { ...ctx, telemetry: {...} };
 *   },
 *   verify: (ctx) => {
 *     // Check DB, SDK, Agent layers
 *     return { verdict: 'pass' };
 *   }
 * });
 * ```
 */
export async function runSchemaScenario(
  prisma: PrismaService,
  testCase: OntologyTestCase,
): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const result = await withEphemeralTenant(prisma, async (ephCtx) => {
    let verdict: TestVerdict;
    let telemetry: TelemetryData = { latency: 0 };

    try {
      // Setup phase
      const setupCtx = await testCase.setup();

      // Execute phase (schema change)
      const executeT0 = Date.now();
      const executeCtx = await testCase.execute(setupCtx);
      const executeLatency = Date.now() - executeT0;

      telemetry = {
        ...executeCtx.telemetry,
        latency: executeLatency,
      };

      // Verify phase (3-layer check)
      const verifyFn = testCase.verify;
      verdict = typeof verifyFn === 'function' && verifyFn.constructor.name === 'AsyncFunction'
        ? await (verifyFn as (ctx: ExecuteContext) => Promise<TestVerdict>)(executeCtx)
        : (verifyFn as (ctx: ExecuteContext) => TestVerdict)(executeCtx);

    } catch (error: any) {
      verdict = {
        verdict: 'fail',
        reason: `Exception during execution: ${error.message}`,
      };
      telemetry.errors = [
        ...(telemetry.errors || []),
        {
          message: error.message,
          stack: error.stack,
          timestamp: Date.now(),
        },
      ];
    }

    return { verdict, telemetry };
  });

  const completedAt = new Date().toISOString();
  const duration = Date.now() - t0;

  return {
    id: testCase.id,
    title: testCase.title,
    category: testCase.category,
    track: testCase.track,
    verdict: result.verdict,
    telemetry: result.telemetry,
    startedAt,
    completedAt,
    duration,
  };
}

/**
 * Query scenario: setup → execute Agent query via SSE → verify ground truth
 *
 * Execution flow:
 * 1. Setup: Provision tenant + seed data
 * 2. Execute: Send user message to Agent via in-process orchestrator.run()
 * 3. Parse SSE stream: Extract tool_calls, final text, errors
 * 4. Verify: Compare Agent result to ground truth via pure judge function
 *
 * Uses in-process orchestrator.run() pattern from repro-rice-cooker-chat.ts:
 * - No HTTP, no JWT, no server startup
 * - Direct orchestrator invocation with CurrentUser actor
 * - Captures full SSE event stream (tool_call, tool_result, text, error)
 *
 * @param prisma PrismaService instance
 * @param orchestrator OrchestratorService instance (request-scoped)
 * @param sdk OntologySdk instance (request-scoped)
 * @param testCase Test case with setup/execute/verify phases
 * @returns ScenarioResult with ground truth verdict + telemetry
 *
 * @example
 * ```ts
 * const result = await runQueryScenario(prisma, orchestrator, sdk, {
 *   id: 'query-001',
 *   title: 'Market metric value query',
 *   category: 'metric-catalogue',
 *   track: 'agent',
 *   setup: async () => ({ tenantId, seedData: {...} }),
 *   execute: async (ctx) => {
 *     // Execute handled by runner - just provide message
 *     return { ...ctx, message: '电饭煲2024年1月零售额是多少？', telemetry: {...} };
 *   },
 *   verify: (ctx) => {
 *     // Compare agentValue to groundTruthValue
 *     return { verdict: ctx.agentValue === ctx.groundTruthValue ? 'pass' : 'fail' };
 *   }
 * });
 * ```
 */
export async function runQueryScenario(
  prisma: PrismaService,
  orchestrator: OrchestratorService,
  sdk: OntologySdk,
  testCase: OntologyTestCase,
): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const result = await withEphemeralTenant(prisma, async (ephCtx) => {
    let verdict: TestVerdict;
    let telemetry: TelemetryData = { latency: 0, toolCalls: [] };

    try {
      // Setup phase
      const setupCtx = await testCase.setup();

      // Execute phase - expect setupCtx to have tenantId and message
      const executeCtx = await testCase.execute(setupCtx);
      const message = (executeCtx as any).message;
      if (!message) {
        throw new Error('Execute context must provide a "message" field for query scenarios');
      }

      // Build CurrentUser actor from ephemeral tenant's admin user
      const actor: CurrentUser = {
        id: ephCtx.adminUser.id,
        email: ephCtx.adminUser.email,
        name: ephCtx.adminUser.name,
        tenantId: ephCtx.tenant.id,
        roleId: ephCtx.ownerRoleId,
        roleName: 'owner',
        permissions: [
          'tenant.admin',
          'object.define',
          'object.read',
          'object.query',
          'object.write',
          'data.import',
          'conversation.create',
        ],
        permissionRules: [
          { permission: 'tenant.admin' },
          { permission: 'object.define' },
          { permission: 'object.read' },
          { permission: 'object.query' },
          { permission: 'object.write' },
          { permission: 'data.import' },
          { permission: 'conversation.create' },
        ],
      };

      // Fetch schema summary and tenant profile for Agent
      const [{ summary, typeNames }, tenantProfile] = await Promise.all([
        sdk.getSchemaSummary(ephCtx.tenant.id),
        sdk.getTenantProfile(ephCtx.tenant.id),
      ]);

      // Execute in-process orchestrator.run() and capture SSE stream
      const queryT0 = Date.now();
      let ttfb = 0;
      let textOut = '';
      const toolCalls: Array<{ toolName: string; args: Record<string, unknown>; timestamp: number }> = [];
      const errors: Array<{ message: string; stack?: string; timestamp: number }> = [];

      for await (const ev of orchestrator.run({
        user: actor,
        message,
        schemaSummary: summary,
        tenantProfile,
        objectTypeNames: typeNames,
      })) {
        if (ttfb === 0) {
          ttfb = Date.now() - queryT0;
        }

        switch (ev.type) {
          case 'tool_call':
            toolCalls.push({
              toolName: ev.name,
              args: ev.args,
              timestamp: Date.now(),
            });
            break;
          case 'tool_result':
            // Store tool result in executeCtx for judge access
            (executeCtx as any).lastToolResult = ev.data;
            break;
          case 'text':
            textOut = ev.content;
            break;
          case 'error':
            errors.push({
              message: ev.message,
              timestamp: Date.now(),
            });
            break;
        }
      }

      const queryLatency = Date.now() - queryT0;

      telemetry = {
        ttfb,
        latency: queryLatency,
        toolCalls,
        errors: errors.length > 0 ? errors : undefined,
      };

      // Store Agent response in executeCtx for verify phase
      (executeCtx as any).agentResponse = textOut;
      (executeCtx as any).telemetry = telemetry;

      // Verify phase (ground truth comparison)
      const verifyFn = testCase.verify;
      verdict = typeof verifyFn === 'function' && verifyFn.constructor.name === 'AsyncFunction'
        ? await (verifyFn as (ctx: ExecuteContext) => Promise<TestVerdict>)(executeCtx)
        : (verifyFn as (ctx: ExecuteContext) => TestVerdict)(executeCtx);

    } catch (error: any) {
      verdict = {
        verdict: 'fail',
        reason: `Exception during query execution: ${error.message}`,
      };
      telemetry.errors = [
        ...(telemetry.errors || []),
        {
          message: error.message,
          stack: error.stack,
          timestamp: Date.now(),
        },
      ];
    }

    return { verdict, telemetry };
  });

  const completedAt = new Date().toISOString();
  const duration = Date.now() - t0;

  return {
    id: testCase.id,
    title: testCase.title,
    category: testCase.category,
    track: testCase.track,
    verdict: result.verdict,
    telemetry: result.telemetry,
    startedAt,
    completedAt,
    duration,
  };
}

/**
 * Agent scenario: Multi-turn conversation with auto-confirm support
 *
 * Execution flow:
 * 1. Setup: Provision tenant + seed data
 * 2. Execute: Run multi-turn conversation via in-process orchestrator
 * 3. Auto-confirm: Detect confirmation_request events and auto-approve
 * 4. Verify: Check conversation transcript, final responses, tool usage
 *
 * Reuses ChatSession pattern from uat-chat-harness.ts:
 * - conversationId threading across turns
 * - Auto-confirm on confirmation_request (simulating user clicking 确认)
 * - Captures full transcript + telemetry per turn
 *
 * @param prisma PrismaService instance
 * @param orchestrator OrchestratorService instance (request-scoped)
 * @param sdk OntologySdk instance (request-scoped)
 * @param testCase Test case with setup/execute/verify phases
 * @returns ScenarioResult with multi-turn verdict + aggregated telemetry
 *
 * @example
 * ```ts
 * const result = await runAgentScenario(prisma, orchestrator, sdk, {
 *   id: 'agent-001',
 *   title: 'Multi-turn pronoun resolution',
 *   category: 'agent-routing',
 *   track: 'agent',
 *   setup: async () => ({ tenantId, seedData: {...} }),
 *   execute: async (ctx) => {
 *     // Provide turns array
 *     return { ...ctx, turns: ['电饭煲26.04零售额？', '零售量呢？'], telemetry: {...} };
 *   },
 *   verify: (ctx) => {
 *     // Check transcript for correct pronoun resolution
 *     return { verdict: ctx.transcript.length === 4 ? 'pass' : 'fail' }; // 2 user + 2 agent
 *   }
 * });
 * ```
 */
export async function runAgentScenario(
  prisma: PrismaService,
  orchestrator: OrchestratorService,
  sdk: OntologySdk,
  testCase: OntologyTestCase,
): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const result = await withEphemeralTenant(prisma, async (ephCtx) => {
    let verdict: TestVerdict;
    let telemetry: TelemetryData = { latency: 0, toolCalls: [] };

    try {
      // Setup phase
      const setupCtx = await testCase.setup();

      // Execute phase - expect setupCtx to have turns array
      const executeCtx = await testCase.execute(setupCtx);
      const turns = (executeCtx as any).turns;
      if (!Array.isArray(turns) || turns.length === 0) {
        throw new Error('Execute context must provide a "turns" array for agent scenarios');
      }

      // Build CurrentUser actor
      const actor: CurrentUser = {
        id: ephCtx.adminUser.id,
        email: ephCtx.adminUser.email,
        name: ephCtx.adminUser.name,
        tenantId: ephCtx.tenant.id,
        roleId: ephCtx.ownerRoleId,
        roleName: 'owner',
        permissions: [
          'tenant.admin',
          'object.define',
          'object.read',
          'object.query',
          'object.write',
          'data.import',
          'conversation.create',
        ],
        permissionRules: [
          { permission: 'tenant.admin' },
          { permission: 'object.define' },
          { permission: 'object.read' },
          { permission: 'object.query' },
          { permission: 'object.write' },
          { permission: 'data.import' },
          { permission: 'conversation.create' },
        ],
      };

      // Fetch schema summary and tenant profile
      const [{ summary, typeNames }, tenantProfile] = await Promise.all([
        sdk.getSchemaSummary(ephCtx.tenant.id),
        sdk.getTenantProfile(ephCtx.tenant.id),
      ]);

      // Multi-turn conversation with conversationId threading
      const transcript: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }> = [];
      const allToolCalls: Array<{ toolName: string; args: Record<string, unknown>; timestamp: number }> = [];
      const allErrors: Array<{ message: string; stack?: string; timestamp: number }> = [];
      let conversationId: string | undefined;
      let totalLatency = 0;
      let firstTtfb = 0;

      for (let i = 0; i < turns.length; i++) {
        const message = turns[i];
        const turnT0 = Date.now();
        let ttfb = 0;
        let textOut = '';
        let confirmationPending = false;

        // Add user message to transcript
        transcript.push({
          role: 'user',
          content: message,
          timestamp: Date.now(),
        });

        // Execute turn
        for await (const ev of orchestrator.run({
          user: actor,
          message,
          schemaSummary: summary,
          tenantProfile,
          objectTypeNames: typeNames,
          conversationId, // Thread conversation across turns
        })) {
          if (ttfb === 0) {
            ttfb = Date.now() - turnT0;
            if (firstTtfb === 0) {
              firstTtfb = ttfb;
            }
          }

          switch (ev.type) {
            case 'tool_call':
              allToolCalls.push({
                toolName: ev.name,
                args: ev.args,
                timestamp: Date.now(),
              });
              break;
            case 'text':
              textOut = ev.content;
              break;
            case 'confirmation_request':
              confirmationPending = true;
              break;
            case 'error':
              allErrors.push({
                message: ev.message,
                timestamp: Date.now(),
              });
              break;
            case 'done':
              if (ev.conversationId) {
                conversationId = ev.conversationId;
              }
              break;
          }
        }

        const turnLatency = Date.now() - turnT0;
        totalLatency += turnLatency;

        // Add assistant response to transcript
        transcript.push({
          role: 'assistant',
          content: textOut,
          timestamp: Date.now(),
        });

        // Auto-confirm if needed (simulates user clicking 确认)
        if (confirmationPending && conversationId) {
          const confirmT0 = Date.now();
          let confirmText = '';

          // Resume with confirmation
          // Note: Auto-confirm in real Agent flow requires calling a separate /confirm endpoint
          // For in-process orchestrator, confirmation is handled by the ConfirmationGate service
          // which stores pending confirmations and checks conversationId state.
          // This is a simplified stub - real impl would need ConfirmationGate.confirm() call
          for await (const ev of orchestrator.run({
            user: actor,
            message: '', // Empty message for resumed conversation
            schemaSummary: summary,
            tenantProfile,
            objectTypeNames: typeNames,
            conversationId,
          })) {
            switch (ev.type) {
              case 'tool_call':
                allToolCalls.push({
                  toolName: ev.name,
                  args: ev.args,
                  timestamp: Date.now(),
                });
                break;
              case 'text':
                confirmText = ev.content;
                break;
              case 'error':
                allErrors.push({
                  message: ev.message,
                  timestamp: Date.now(),
                });
                break;
            }
          }

          const confirmLatency = Date.now() - confirmT0;
          totalLatency += confirmLatency;

          // Update transcript with resumed response
          if (confirmText) {
            transcript[transcript.length - 1].content = confirmText;
          }
        }
      }

      telemetry = {
        ttfb: firstTtfb,
        latency: totalLatency,
        toolCalls: allToolCalls,
        errors: allErrors.length > 0 ? allErrors : undefined,
      };

      // Store transcript in executeCtx for verify phase
      (executeCtx as any).transcript = transcript;
      (executeCtx as any).agentResponse = transcript[transcript.length - 1]?.content || '';
      (executeCtx as any).telemetry = telemetry;

      // Verify phase
      const verifyFn = testCase.verify;
      verdict = typeof verifyFn === 'function' && verifyFn.constructor.name === 'AsyncFunction'
        ? await (verifyFn as (ctx: ExecuteContext) => Promise<TestVerdict>)(executeCtx)
        : (verifyFn as (ctx: ExecuteContext) => TestVerdict)(executeCtx);

    } catch (error: any) {
      verdict = {
        verdict: 'fail',
        reason: `Exception during agent scenario: ${error.message}`,
      };
      telemetry.errors = [
        ...(telemetry.errors || []),
        {
          message: error.message,
          stack: error.stack,
          timestamp: Date.now(),
        },
      ];
    }

    return { verdict, telemetry };
  });

  const completedAt = new Date().toISOString();
  const duration = Date.now() - t0;

  return {
    id: testCase.id,
    title: testCase.title,
    category: testCase.category,
    track: testCase.track,
    verdict: result.verdict,
    telemetry: result.telemetry,
    startedAt,
    completedAt,
    duration,
  };
}
