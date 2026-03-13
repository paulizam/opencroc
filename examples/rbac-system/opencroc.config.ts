import { defineConfig } from 'opencroc';

/**
 * OpenCroc configuration for the rbac-system-pc backend.
 *
 * This Sequelize-based backend has:
 * - 100+ models in src/models/ (flat layout, no subdirectories)
 * - 75+ controllers in src/controllers/
 * - Associations embedded at the bottom of each model file
 * - Multi-tenant architecture (tenant_id on every table)
 */
export default defineConfig({
  backendRoot: '../../backend/src',
  adapter: 'sequelize',
  outDir: './opencroc-output',
  selfHealing: {
    enabled: true,
    maxIterations: 3,
  },
});
