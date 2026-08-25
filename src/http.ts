import { timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { pathToFileURL } from 'node:url';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  getAppConfig,
  getHttpConfig,
  getHttpListenConfig,
  loadLocalEnvFile,
  type HttpConfig,
} from './config.js';
import { createPortfolioMcpServer } from './server.js';

export type NodeMcpRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
) => Promise<void>;

export type HttpConfigSource = HttpConfig | (() => HttpConfig);

const SHUTDOWN_TIMEOUT_MS = 10_000;

class PayloadTooLargeError extends Error {}
class InvalidJsonError extends Error {}

export function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getRequestUrl(req: IncomingMessage) {
  return new URL(req.url || '/', 'http://portfolio-mcp.local');
}

function resolveHttpConfig(source: HttpConfigSource) {
  return typeof source === 'function' ? source() : source;
}

function configErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown configuration error.';
}

export function isAuthorized(req: IncomingMessage, config: HttpConfig) {
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

export function getCorsOrigin(req: IncomingMessage, config: HttpConfig) {
  const requestOrigin = req.headers.origin;
  if (config.allowedOrigins.includes('*')) return '*';
  if (!requestOrigin) return null;
  return config.allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

export function applyCommonHeaders(req: IncomingMessage, res: ServerResponse, config: HttpConfig) {
  const corsOrigin = getCorsOrigin(req, config);
  if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, accept, authorization, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id',
  );
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
}

function applyStatusHeaders(res: ServerResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  res.end(JSON.stringify(body));
}

function rejectOversizedContentLength(req: IncomingMessage, maxRequestBytes: number) {
  const raw = req.headers['content-length'];
  if (!raw) return false;
  const contentLength = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(contentLength) && contentLength > maxRequestBytes;
}

export async function readJsonBody(req: IncomingMessage, maxRequestBytes: number) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    totalBytes += buffer.length;

    if (totalBytes > maxRequestBytes) {
      req.resume();
      throw new PayloadTooLargeError('MCP request body is too large.');
    }

    chunks.push(buffer);
  }

  if (totalBytes === 0) return undefined;

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new InvalidJsonError('Request body must contain valid JSON.');
  }
}

export async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  configSource: HttpConfigSource,
  nodeMcpHandler: NodeMcpRequestHandler,
) {
  const requestUrl = getRequestUrl(req);

  if (req.method === 'GET' && requestUrl.pathname === '/') {
    applyStatusHeaders(res);
    sendJson(res, 200, {
      service: 'portfolio-mcp',
      status: 'running',
      health: '/healthz',
      readiness: '/readyz',
      mcp: '/mcp',
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/healthz') {
    applyStatusHeaders(res);
    sendJson(res, 200, {
      ok: true,
      service: 'portfolio-mcp',
      transport: 'streamable-http',
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/readyz') {
    applyStatusHeaders(res);
    try {
      getAppConfig();
      resolveHttpConfig(configSource);
      sendJson(res, 200, {
        ready: true,
        service: 'portfolio-mcp',
      });
    } catch (error) {
      sendJson(res, 503, {
        ready: false,
        service: 'portfolio-mcp',
        error: configErrorMessage(error),
      });
    }
    return;
  }

  if (requestUrl.pathname !== '/mcp' && requestUrl.pathname !== '/mcp/') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  let config: HttpConfig;
  try {
    config = resolveHttpConfig(configSource);
  } catch (error) {
    sendJson(res, 503, {
      error: 'MCP service is not configured.',
      detail: configErrorMessage(error),
    });
    return;
  }

  applyCommonHeaders(req, res, config);

  const requestOrigin = req.headers.origin;
  if (requestOrigin && !getCorsOrigin(req, config)) {
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

  if (!isAuthorized(req, config)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  if (req.method === 'POST' && rejectOversizedContentLength(req, config.maxRequestBytes)) {
    req.resume();
    sendJson(res, 413, { error: 'Request body too large' });
    return;
  }

  try {
    const parsedBody = req.method === 'POST'
      ? await readJsonBody(req, config.maxRequestBytes)
      : undefined;

    await nodeMcpHandler(req, res, parsedBody);
  } catch (error) {
    if (res.headersSent || res.writableEnded) {
      console.error('[portfolio-mcp] request failed after response started', error);
      return;
    }

    if (error instanceof PayloadTooLargeError) {
      sendJson(res, 413, { error: 'Request body too large' });
      return;
    }

    if (error instanceof InvalidJsonError) {
      sendJson(res, 400, { error: 'Invalid JSON request body' });
      return;
    }

    console.error('[portfolio-mcp] HTTP request failed', error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

export function createPortfolioHttpServer(
  configSource: HttpConfigSource,
  nodeMcpHandler: NodeMcpRequestHandler,
) {
  return createServer((req, res) => {
    void handleHttpRequest(req, res, configSource, nodeMcpHandler);
  });
}

export async function closeNodeServer(server: Server, timeoutMs = SHUTDOWN_TIMEOUT_MS) {
  if (!server.listening) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, timeoutMs);
    timer.unref();

    server.close(() => finish());
    server.closeIdleConnections?.();
  });
}

async function listen(server: Server, port: number, host: string) {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export async function startHttpRuntime() {
  loadLocalEnvFile();
  const listenConfig = getHttpListenConfig();

  const mcpHandler = createMcpHandler(createPortfolioMcpServer, {
    responseMode: 'json',
    legacy: 'stateless',
    onerror: (error) => console.error('[portfolio-mcp] MCP handler error', error),
  });

  const nodeMcpHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => console.error('[portfolio-mcp] HTTP adapter error', error),
  }) as NodeMcpRequestHandler;

  const server = createPortfolioHttpServer(getHttpConfig, nodeMcpHandler);
  await listen(server, listenConfig.port, listenConfig.host);

  console.error(`[portfolio-mcp] listening on http://${listenConfig.host}:${listenConfig.port}/mcp`);
  return { server, mcpHandler, listenConfig };
}

async function main() {
  const { server, mcpHandler } = await startHttpRuntime();
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = (signal: string) => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      console.error(`[portfolio-mcp] received ${signal}; shutting down`);
      await closeNodeServer(server);
      await mcpHandler.close();
      process.exitCode = 0;
    })();

    return shutdownPromise;
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error) => {
    console.error('[portfolio-mcp] failed to start', error);
    process.exitCode = 1;
  });
}
