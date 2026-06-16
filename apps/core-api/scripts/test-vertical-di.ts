/**
 * Simplified live test: verify vertical contributions landed in the running app's DI container.
 * No LLM calls, no external dependencies — pure DI introspection.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AGENT_SKILLS } from '../src/modules/tool-registry/tool-registry.tokens';
import { OrchestratorService } from '../src/modules/orchestrator/orchestrator.service';

async function main() {
  console.log('=== Vertical Integration Verification (DI-level) ===\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  // Test 1: AGENT_SKILLS contains the reference vertical's sales_analysis skill
  console.log('[Test 1] Vertical skill contribution');
  const skills = app.get<any[]>(AGENT_SKILLS);
  const hasSalesAnalysis = skills.some(s => s.name === 'sales_analysis');
  console.log(`  Skills in DI: ${skills.map(s => s.name).join(', ')}`);
  console.log(hasSalesAnalysis ? '  ✓ sales_analysis skill present' : '  ✗ sales_analysis missing');

  // Test 2: OrchestratorService has drill-gates injected (both AVC + reference vertical)
  console.log('\n[Test 2] Drill-gate injection');
  const orchestrator = app.get(OrchestratorService);
  const gates = (orchestrator as any).drillGates || [];
  console.log(`  Injected gates: ${gates.length}`);
  const hasModelMetricGate = gates.some((g: any) => g.drillTarget === 'model_metric');
  const hasSalesLineGate = gates.some((g: any) => g.drillTarget === 'sales_line');
  console.log(`  - AVC gate (model_metric): ${hasModelMetricGate ? '✓' : '✗'}`);
  console.log(`  - Reference gate (sales_line): ${hasSalesLineGate ? '✓' : '✗'}`);

  console.log('\n=== Summary ===');
  console.log(`Vertical skill contribution: ${hasSalesAnalysis ? 'PASS' : 'FAIL'}`);
  console.log(`Drill-gate injection: ${hasModelMetricGate && hasSalesLineGate ? 'PASS' : 'FAIL'}`);

  await app.close();
  process.exit(hasSalesAnalysis && hasModelMetricGate && hasSalesLineGate ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(2);
});
