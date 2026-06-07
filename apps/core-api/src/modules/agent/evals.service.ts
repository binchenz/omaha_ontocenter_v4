import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, Prisma } from '@omaha/db';
import {
  comparePlanCore,
  extractPlanCore,
  isDataQueryTool,
  type CurrentUser as CurrentUserType,
  type PlanComparison,
} from '@omaha/shared-types';
import { OrchestratorService, AgentEvent } from '../orchestrator/orchestrator.service';
import { OntologySdk } from '../ontology/ontology.sdk';
import { PlanSummarizer } from './plan-summarizer.service';

export interface CapturedPlan {
  tool: string;
  args: Record<string, unknown>;
}

export interface EvalQuestionView {
  id: string;
  question: string;
  baselineTool: string;
  baselineArgs: Record<string, unknown>;
  planSummary: string | null;
  passHistory: number[];
  createdAt: Date;
}

export interface EvalRunResult {
  questionId: string;
  question: string;
  pass: boolean;
  diffs: string[];
  actual: CapturedPlan | null;
}

export interface EvalNRunResult {
  questionId: string;
  question: string;
  n: number;
  passes: number;
  /** passes / n, in [0,1]. */
  passRate: number;
  runs: Array<{ pass: boolean; diffs: string[] }>;
}

export interface EvalSoftGate {
  threshold: number;
  total: number;
  belowThreshold: Array<{ id: string; question: string; passRate: number | null }>;
  /** True when at least one question is below threshold — the OPC must acknowledge before publish. */
  requiresAck: boolean;
}

/** Defaults from the ADR-0029 probe: N=8 repetitions, pass-rate threshold 0.8 (tunable). */
export const DEFAULT_N = 8;
export const DEFAULT_THRESHOLD = 0.8;

/**
 * Accuracy Evals (ADR-0033): capture an expected query-plan baseline from a chat answer
 * and score re-runs by query-plan STRUCTURE (the pure extractPlanCore/comparePlanCore),
 * not by final numbers. This service is the orchestration shell; the scoring brain is the
 * pure module. #72 ships capture + single-run scoring; #75 layers N-run pass rates + the
 * soft publish gate on top.
 */
@Injectable()
export class EvalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: OrchestratorService,
    private readonly sdk: OntologySdk,
    private readonly planSummarizer: PlanSummarizer,
  ) {}

  /**
   * Capture a question + its expected plan as a baseline. The plan is the tool call the
   * OPC judged correct in chat (the frontend already has it from the tool_call event); we
   * recompute the display summary server-side so it always matches current ontology labels.
   */
  async capture(
    tenantId: string,
    input: { question: string; baselineTool: string; baselineArgs: Record<string, unknown> },
  ): Promise<EvalQuestionView> {
    const planSummary = await this.planSummarizer.summarize(tenantId, input.baselineTool, input.baselineArgs ?? {});
    const row = await this.prisma.evalQuestion.create({
      data: {
        tenantId,
        question: input.question,
        baselineTool: input.baselineTool,
        baselineArgs: (input.baselineArgs ?? {}) as Prisma.InputJsonValue,
        planSummary: planSummary ?? null,
      },
    });
    return this.toView(row);
  }

  async list(tenantId: string): Promise<EvalQuestionView[]> {
    const rows = await this.prisma.evalQuestion.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const row = await this.prisma.evalQuestion.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Eval 问题不存在');
    await this.prisma.evalQuestion.delete({ where: { id } });
  }

  /** Run one captured question once and score its plan structurally against the baseline. */
  async runOnce(user: CurrentUserType, id: string): Promise<EvalRunResult> {
    const row = await this.prisma.evalQuestion.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException('Eval 问题不存在');

    const actual = await this.runQuestionForPlan(user, row.question);
    const comparison = this.score(
      { tool: row.baselineTool, args: row.baselineArgs as Record<string, unknown> },
      actual,
    );
    return {
      questionId: row.id,
      question: row.question,
      pass: comparison.match,
      diffs: comparison.diffs,
      actual,
    };
  }

  /** Pure scoring step exposed for reuse by the N-run runner (#75). */
  score(expected: CapturedPlan, actual: CapturedPlan | null): PlanComparison {
    if (!actual) return { match: false, diffs: ['Agent 未产生查询计划'] };
    return comparePlanCore(
      extractPlanCore(expected.tool, expected.args),
      extractPlanCore(actual.tool, actual.args),
    );
  }

  /**
   * Run one question the FULL N times (no early stop) and report the pass rate. This is the
   * deliberate inversion of the probe's runWithRetry (pass-if-any): retrying-until-pass hides
   * the very non-determinism the OPC must see — a question that is 8/8 and one that is 5/8
   * carry completely different delivery confidence (ADR-0033). Records the rate to history.
   */
  async runQuestionNTimes(user: CurrentUserType, id: string, n: number = DEFAULT_N): Promise<EvalNRunResult> {
    const row = await this.prisma.evalQuestion.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException('Eval 问题不存在');
    const expected: CapturedPlan = { tool: row.baselineTool, args: row.baselineArgs as Record<string, unknown> };

    let passes = 0;
    const runs: Array<{ pass: boolean; diffs: string[] }> = [];
    for (let i = 0; i < n; i++) {
      const actual = await this.runQuestionForPlan(user, row.question);
      const cmp = this.score(expected, actual);
      if (cmp.match) passes++;
      runs.push({ pass: cmp.match, diffs: cmp.diffs });
    }
    const passRate = n > 0 ? passes / n : 0;

    const history = (Array.isArray(row.passHistory) ? (row.passHistory as number[]) : []).concat(passRate).slice(-20);
    await this.prisma.evalQuestion.update({ where: { id }, data: { passHistory: history as Prisma.InputJsonValue } });

    return { questionId: id, question: row.question, n, passes, passRate, runs };
  }

  /** Run every captured question N times; the OPC's pre-delivery accuracy report. */
  async runBank(user: CurrentUserType, n: number = DEFAULT_N): Promise<EvalNRunResult[]> {
    const rows = await this.prisma.evalQuestion.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'asc' } });
    const results: EvalNRunResult[] = [];
    for (const row of rows) {
      results.push(await this.runQuestionNTimes(user, row.id, n));
    }
    return results;
  }

  /**
   * Soft publish gate (ADR-0033): from the latest recorded pass rate per question, surface
   * the ones below threshold. Pure read of persisted history — no agent runs — so the publish
   * flow can cheaply check "are there unstable questions the OPC should acknowledge?".
   */
  async softGate(tenantId: string, threshold: number = DEFAULT_THRESHOLD): Promise<EvalSoftGate> {
    const rows = await this.prisma.evalQuestion.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    const belowThreshold = rows
      .map((r) => {
        const hist = Array.isArray(r.passHistory) ? (r.passHistory as number[]) : [];
        const latest = hist.length > 0 ? hist[hist.length - 1] : null;
        return { id: r.id, question: r.question, passRate: latest };
      })
      .filter((q) => q.passRate !== null && (q.passRate as number) < threshold);
    return {
      threshold,
      total: rows.length,
      belowThreshold,
      requiresAck: belowThreshold.length > 0,
    };
  }

  /**
   * Run a question through the agent and return the first data-tool plan it produced.
   * Consumes the orchestrator generator directly (no SSE) — the server-side analogue of
   * the drama-query probe's postSse loop.
   */
  async runQuestionForPlan(user: CurrentUserType, question: string): Promise<CapturedPlan | null> {
    const { summary, typeNames } = await this.sdk.getSchemaSummary(user.tenantId);
    const generator = this.orchestrator.run({
      user,
      message: question,
      schemaSummary: summary,
      objectTypeNames: typeNames,
    });
    for await (const event of generator as AsyncGenerator<AgentEvent>) {
      if (event.type === 'tool_call' && isDataQueryTool(event.name)) {
        return { tool: event.name, args: event.args ?? {} };
      }
    }
    return null;
  }

  private toView(row: {
    id: string;
    question: string;
    baselineTool: string;
    baselineArgs: unknown;
    planSummary: string | null;
    passHistory: unknown;
    createdAt: Date;
  }): EvalQuestionView {
    return {
      id: row.id,
      question: row.question,
      baselineTool: row.baselineTool,
      baselineArgs: (row.baselineArgs ?? {}) as Record<string, unknown>,
      planSummary: row.planSummary,
      passHistory: Array.isArray(row.passHistory) ? (row.passHistory as number[]) : [],
      createdAt: row.createdAt,
    };
  }
}
