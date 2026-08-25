import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { getAppConfig } from './config.js';
import { createPortfolioMcpServer } from './server.js';

getAppConfig();

console.error('[portfolio-mcp] serving over stdio');
void serveStdio(createPortfolioMcpServer);
