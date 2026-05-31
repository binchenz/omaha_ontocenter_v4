import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { EvalsService, DEFAULT_N } from './evals.service';

interface CaptureBody {
  question: string;
  baselineTool: string;
  baselineArgs: Record<string, unknown>;
}

/**
 * OPC accuracy-Evals endpoints (ADR-0033). Capture is the only authoring path — the OPC
 * never hand-writes plan JSON; they click "add to Evals" on a chat answer they judged
 * correct, and the frontend posts the plan it already received from the tool_call event.
 */
@Controller('evals')
@UseGuards(JwtAuthGuard)
export class EvalsController {
  constructor(private readonly evals: EvalsService) {}

  @Get('questions')
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.evals.list(tenantId);
  }

  @Post('questions')
  capture(@CurrentUser('tenantId') tenantId: string, @Body() body: CaptureBody) {
    return this.evals.capture(tenantId, body);
  }

  @Delete('questions/:id')
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.evals.remove(tenantId, id);
  }

  /** Run one captured question once and score its plan against the baseline (#72). */
  @Post('questions/:id/run')
  runOnce(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.evals.runOnce(user, id);
  }

  /** Run one question the full N times and report its pass rate (#75). */
  @Post('questions/:id/run-n')
  runN(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() body: { n?: number } = {},
  ) {
    return this.evals.runQuestionNTimes(user, id, clampN(body?.n));
  }

  /** Run the whole question bank N times each — the pre-delivery accuracy report (#75). */
  @Post('run-bank')
  runBank(@CurrentUser() user: CurrentUserType, @Body() body: { n?: number } = {}) {
    return this.evals.runBank(user, clampN(body?.n));
  }

  /** Soft publish gate: questions below the pass-rate threshold from recorded history (#75). */
  @Get('soft-gate')
  softGate(@CurrentUser('tenantId') tenantId: string, @Query('threshold') threshold?: string) {
    const t = threshold !== undefined ? Number(threshold) : undefined;
    return this.evals.softGate(tenantId, t !== undefined && !Number.isNaN(t) ? t : undefined);
  }
}

/** Clamp N to a sane range so a runaway request can't launch hundreds of agent runs. */
function clampN(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : DEFAULT_N;
  return Math.max(1, Math.min(20, v));
}
