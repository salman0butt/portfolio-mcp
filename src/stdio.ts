import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { getAppConfig, loadLocalEnvFile } from './config.js';
import { createPortfolioMcpServer } from './server.js';

async function main() {
  loadLocalEnvFile();
  getAppConfig();

  console.error('[portfolio-mcp] serving over stdio');
  await serveStdio(createPortfolioMcpServer);
}

void main().catch((error) => {
  console.error('[portfolio-mcp] stdio server failed', error);
  process.exitCode = 1;
});
