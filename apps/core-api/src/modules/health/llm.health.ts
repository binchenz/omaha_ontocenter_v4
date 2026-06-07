import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';

export interface LlmHealthStatus {
  reachable: boolean;
  lastSuccess?: Date;
  lastFailure?: Date;
  lastError?: string;
}

@Injectable()
export class LlmHealthIndicator extends HealthIndicator {
  private lastSuccess?: Date;
  private lastFailure?: Date;
  private lastError?: string;

  recordSuccess(): void {
    this.lastSuccess = new Date();
  }

  recordFailure(error: string): void {
    this.lastFailure = new Date();
    this.lastError = error;
  }

  getLlmStatus(): LlmHealthStatus {
    const reachable = this.lastSuccess != null && (this.lastFailure == null || this.lastSuccess > this.lastFailure);
    return {
      reachable,
      lastSuccess: this.lastSuccess,
      lastFailure: this.lastFailure,
      lastError: this.lastError,
    };
  }

  async isHealthy(key = 'llm'): Promise<HealthIndicatorResult> {
    const status = this.getLlmStatus();
    const result = this.getStatus(key, status.reachable, {
      reachable: status.reachable,
      lastSuccess: status.lastSuccess?.toISOString(),
      lastFailure: status.lastFailure?.toISOString(),
      lastError: status.lastError,
    });
    return result;
  }
}
