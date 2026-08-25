import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { getAppConfig, getHttpConfig, type HttpConfig } from './config.js';
import { createPortfolioMcpServer } from './server.js';

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function getRequestUrl(req: IncomingMessage) {
  return new URL(req.url || '/', 'http://portfolio-mcp.local');
}

function isAuthorized(req: IncomingMessage, config: HttpConfig) {
  const requestUrl = getRequestUrl(req);
  const queryToken = requestUrl.searchParams.get('token');
  if (queryToken && config.urlToken && secureEqual(queryToken, config.urlToken)) {
    return true;
  }

  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ') && config.bearerToken) {
    return secureEqual(authorization.slice(7), config.bearerToken);
  }

  return false;
}

function getCorsOrigin(req: IncomingMessage, config: HttpConfig) {
  const requestOrigin = req.headers.origin;
  if (config.allowedOrigins.includes('*')) return '*';
  if (!requestOrigin) return null;
  return config.allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

function applyCommonHeaders(req: IncomingMessage, res: ServerResponse, config: HttpConfig) {
  const corsOrigin = getCorsOrigin(req, config);
  if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
  );
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  res.end(JSON.stringify(body));
}

const appConfig = getAppConfig();
const httpConfig = getHttpConfig();
void appConfig;

const mcpHandler = createMcpHandler(createPortfolioMcpServer, {
  responseMode: 'json',
  legacy: 'stateless',
});

const nodeMcpHandler = toNodeHandler(mcpHandler, {
  onerror: (error) => console.error('[portfolio-mcp] HTTP adapter error', error),
});

const server = createServer((req, res) => {
  applyCommonHeaders(req, res, httpConfig);
  const requestUrl = getRequestUrl(req);

  if (requestUrl.pathname === '/healthz') {
    sendJson(res, 200, {
      ok: true,
      service: 'portfolio-mcp',
      transport: 'streamable-http',
    });
    return;
  }

  if (requestUrl.pathname !== '/mcp' && requestUrl.pathname !== '/mcp/') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const requestOrigin = req.headers.origin;
  if (requestOrigin && !getCorsOrigin(req, httpConfig)) {
    sendJson(res, 403, { error: 'Origin not allowed' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (!isAuthorized(req, httpConfig)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  void nodeMcpHandler(req, res);
});

server.listen(httpConfig.port, httpConfig.host, () => {
  console.error(
    `[portfolio-mcp] listening on http://${httpConfig.host}:${httpConfig.port}/mcp`,
  );
});

async function shutdown(signal: string) {
  console.error(`[portfolio-mcp] received ${signal}; shutting down`);
  server.close();
  await mcpHandler.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
