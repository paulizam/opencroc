import chalk from 'chalk';
import { loadConfig } from '../load-config.js';

export interface ServeCommandOptions {
  port?: string;
  host?: string;
  open?: boolean;
}

export async function serve(opts: ServeCommandOptions): Promise<void> {
  let loaded;
  try {
    loaded = await loadConfig();
  } catch {
    console.error(chalk.red('No opencroc config found. Run `opencroc init` first.'));
    process.exitCode = 1;
    return;
  }

  const port = parseInt(opts.port || '8765', 10);
  const host = opts.host || 'localhost';

  console.log(chalk.cyan('🐊 Starting OpenCroc Studio...'));
  console.log(chalk.gray(`   Config: ${loaded.filepath}`));
  console.log(chalk.gray(`   Backend: ${loaded.config.backendRoot}`));

  const { startServer } = await import('../../server/index.js');
  await startServer({
    port,
    host,
    open: opts.open ?? true,
    config: loaded.config,
    cwd: process.cwd(),
  });
}
