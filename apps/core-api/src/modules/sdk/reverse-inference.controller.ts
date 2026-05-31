import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReverseInferenceService } from './reverse-inference.service';

interface InferBody {
  connectorId: string;
  /** When true, merge into the existing Draft instead of overwriting (incremental re-entry, #74). */
  merge?: boolean;
}

/**
 * Whole-database reverse-inference endpoint (ADR-0032). Points the platform at a client DB
 * connection and produces a provenance-tagged draft ontology the OPC then refines and
 * publishes through the normal Draft → Publish flow.
 */
@Controller('reverse-inference')
@UseGuards(JwtAuthGuard)
export class ReverseInferenceController {
  constructor(private readonly reverseInference: ReverseInferenceService) {}

  @Post()
  infer(@CurrentUser('tenantId') tenantId: string, @Body() body: InferBody) {
    return this.reverseInference.inferToDraft(tenantId, body.connectorId, { merge: body.merge });
  }
}
