/**
 * Smoke test: run the OpenCroc pipeline on the rbac-system-pc backend.
 * This script is NOT a unit test — it's a one-shot integration check.
 *
 * Usage: npx tsx examples/rbac-system/smoke-test.ts
 */
import { createPipeline } from '../../src/pipeline/index.js';
import type { OpenCrocConfig } from '../../src/types.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config: OpenCrocConfig = {
  backendRoot: path.resolve(__dirname, '../../../backend/src'),
  adapter: 'sequelize',
  outDir: path.resolve(__dirname, 'opencroc-output'),
  steps: ['scan', 'er-diagram', 'api-chain', 'plan', 'codegen', 'validate'],
};

async function main() {
  console.log('🐊 OpenCroc Smoke Test — rbac-system-pc\n');
  console.log(`Backend root: ${config.backendRoot}`);

  const pipeline = createPipeline(config);
  const result = await pipeline.run();

  console.log('\n--- Results ---');
  console.log(`Modules        : ${result.modules.length} (${result.modules.join(', ')})`);
  console.log(`ER Diagrams    : ${result.erDiagrams.size}`);

  for (const [mod, er] of result.erDiagrams) {
    console.log(`  [${mod}] ${er.tables.length} tables, ${er.relations.length} relations`);
  }

  console.log(`Chain Plans    : ${result.chainPlans.size}`);
  for (const [mod, plan] of result.chainPlans) {
    console.log(`  [${mod}] ${plan.chains.length} chains, ${plan.totalSteps} steps`);
  }

  console.log(`Generated Files: ${result.generatedFiles.length}`);
  for (const f of result.generatedFiles.slice(0, 10)) {
    console.log(`  ${f.filePath}`);
  }
  if (result.generatedFiles.length > 10) {
    console.log(`  ... and ${result.generatedFiles.length - 10} more`);
  }

  console.log(`Validation     : ${result.validationErrors.length} issues`);
  const errors = result.validationErrors.filter((e) => e.severity === 'error');
  const warnings = result.validationErrors.filter((e) => e.severity === 'warning');
  if (errors.length) console.log(`  Errors  : ${errors.length}`);
  if (warnings.length) console.log(`  Warnings: ${warnings.length}`);

  console.log(`Duration       : ${result.duration}ms`);
  console.log('\n✅ Smoke test complete.');
}

main().catch((err) => {
  console.error('❌ Smoke test failed:', err);
  process.exit(1);
});
