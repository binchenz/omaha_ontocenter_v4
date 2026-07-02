/**
 * Ontology Test Harness Type Definitions
 *
 * Pure TypeScript type definitions for the ontology test harness.
 * Zero runtime code - types only.
 *
 * Phase 1: Core test case structure, verdict types, and telemetry interfaces.
 */

/**
 * Test category discriminator.
 *
 * Categories organize test cases by the ontology feature under test.
 */
export type TestCategory =
  | 'derived-field'
  | 'dimension-constraint'
  | 'relationship'
  | 'metric-catalogue'
  | 'coverage'
  | 'time-axis'
  | 'additivity'
  | 'multi-input-pipeline'
  | 'agent-routing';

/**
 * Test track discriminator.
 *
 * Tracks organize test cases by execution strategy and verification depth.
 *
 * - `unit`: Isolated component tests, no Agent, direct API calls
 * - `integration`: Multi-component tests, no Agent, orchestrator + worker flow
 * - `agent`: End-to-end Agent conversation tests with ground truth verification
 */
export type TestTrack = 'unit' | 'integration' | 'agent';

/**
 * Test verdict.
 *
 * Dual-rail verdict with NO LLM judge:
 * - `pass`: Test met all verification criteria
 * - `fail`: Test failed at least one verification criterion
 *
 * The `reason` field provides human-readable context for failures.
 */
export interface TestVerdict {
  verdict: 'pass' | 'fail';
  reason?: string;
}

/**
 * Telemetry data captured during test execution.
 *
 * Tracks performance and behavior metrics for Agent and API interactions.
 */
export interface TelemetryData {
  /** Time to first byte (ms) for the initial response */
  ttfb?: number;

  /** Total end-to-end latency (ms) for the full interaction */
  latency: number;

  /** Tool calls made during Agent execution (Agent track only) */
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    timestamp: number;
  }>;

  /** Errors encountered during execution */
  errors?: Array<{
    message: string;
    stack?: string;
    timestamp: number;
  }>;

  /** Token usage (if available from LLM provider) */
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
}

/**
 * Setup context.
 *
 * Provides test case access to shared test infrastructure and data.
 * Setup runs once before execute and produces this context.
 */
export interface SetupContext {
  /** Tenant ID for this test execution */
  tenantId: string;

  /** Object type IDs created or seeded for this test */
  objectTypeIds?: Record<string, string>;

  /** Dataset IDs created or seeded for this test */
  datasetIds?: Record<string, string>;

  /** Pipeline IDs created or seeded for this test */
  pipelineIds?: Record<string, string>;

  /** Any other setup artifacts the test case needs */
  [key: string]: unknown;
}

/**
 * Execute context.
 *
 * Extends SetupContext with execution artifacts.
 * Execute runs after setup and produces this context.
 */
export interface ExecuteContext extends SetupContext {
  /** HTTP response from the API call (unit/integration tracks) */
  response?: {
    status: number;
    body: unknown;
    headers: Record<string, string>;
  };

  /** Agent conversation transcript (Agent track only) */
  transcript?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }>;

  /** Agent final response (Agent track only) */
  agentResponse?: string;

  /** Telemetry data captured during execution */
  telemetry: TelemetryData;

  /** Any other execution artifacts the test case needs */
  [key: string]: unknown;
}

/**
 * Verify context.
 *
 * Alias for ExecuteContext - verify receives everything from execute.
 */
export type VerifyContext = ExecuteContext;

/**
 * Judge function signature.
 *
 * A pure function that examines ExecuteContext and returns a TestVerdict.
 * No side effects, no LLM calls, no I/O.
 *
 * @param ctx - The execution context containing all test artifacts
 * @returns A verdict indicating pass or fail with an optional reason
 */
export type JudgeFn = (ctx: VerifyContext) => TestVerdict;

/**
 * Ontology test case.
 *
 * A single test scenario with setup, execute, and verify phases.
 * The harness orchestrates these phases and captures telemetry.
 *
 * @template TSetup - The type of setup context produced by this test
 * @template TExecute - The type of execute context produced by this test
 */
export interface OntologyTestCase<
  TSetup extends SetupContext = SetupContext,
  TExecute extends ExecuteContext = ExecuteContext,
> {
  /** Unique identifier for this test case */
  id: string;

  /** Human-readable title describing what this test validates */
  title: string;

  /** Category organizing tests by ontology feature */
  category: TestCategory;

  /** Track organizing tests by execution strategy */
  track: TestTrack;

  /**
   * Setup phase.
   *
   * Runs once before execute. Creates or seeds test data, provisions ontology
   * objects, and prepares the tenant for the test scenario.
   *
   * @returns A promise resolving to the setup context
   */
  setup: () => Promise<TSetup>;

  /**
   * Execute phase.
   *
   * Runs the test action: makes an API call (unit/integration) or sends a
   * user message to the Agent (Agent track). Captures telemetry.
   *
   * @param ctx - The setup context from the setup phase
   * @returns A promise resolving to the execute context
   */
  execute: (ctx: TSetup) => Promise<TExecute>;

  /**
   * Verify phase.
   *
   * Checks the execution results against ground truth or expected behavior.
   * Uses a pure judge function (no LLM, no I/O) to produce a verdict.
   *
   * @param ctx - The execute context from the execute phase
   * @returns A promise resolving to a test verdict
   */
  verify: JudgeFn | ((ctx: TExecute) => Promise<TestVerdict>);
}

/**
 * Scenario result.
 *
 * Captures the outcome of running a single test case, including verdict and
 * telemetry.
 */
export interface ScenarioResult {
  /** The test case ID */
  id: string;

  /** The test case title */
  title: string;

  /** The test category */
  category: TestCategory;

  /** The test track */
  track: TestTrack;

  /** The verdict from the verify phase */
  verdict: TestVerdict;

  /** Telemetry data captured during execution */
  telemetry: TelemetryData;

  /** Timestamp when the test started (ISO 8601) */
  startedAt: string;

  /** Timestamp when the test completed (ISO 8601) */
  completedAt: string;

  /** Total duration (ms) for setup + execute + verify */
  duration: number;
}

/**
 * Runnable scenario.
 *
 * A test case with bound execution context, ready to be run by the harness.
 * The harness wraps OntologyTestCase instances into RunnableScenario for
 * uniform execution.
 */
export interface RunnableScenario {
  /** The underlying test case */
  testCase: OntologyTestCase;

  /**
   * Run this scenario.
   *
   * Orchestrates setup → execute → verify and captures telemetry.
   *
   * @returns A promise resolving to the scenario result
   */
  run: () => Promise<ScenarioResult>;
}
