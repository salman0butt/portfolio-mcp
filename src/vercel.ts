import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { getAppConfig, getMcpHttpConfig, type McpHttpConfig } from './config.js';
import { createPortfolioMcpServer } from './mcpFactory.js';

const mcpHandler = createMcpHandler(createPortfolioMcpServer, {
  responseMode: 'json',
  legacy: 'stateless',
  onerror: (error) => console.error('[portfolio-mcp] Vercel MCP handler error', error),
});

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(status: number, body: unknown, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function getCorsOrigin(request: Request, config: McpHttpConfig) {
  const requestOrigin = request.headers.get('origin');
  if (config.allowedOrigins.includes('*')) return '*';
  if (!requestOrigin) return null;
  return config.allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

function corsHeaders(request: Request, config: McpHttpConfig) {
  const headers = new Headers();
  const origin = getCorsOrigin(request, config);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'content-type, accept, authorization, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id',
  );
  headers.set('Access-Control-Expose-Headers', 'mcp-session-id');
  headers.set('Access-Control-Max-Age', '600');
  headers.set('Vary', 'Origin');
  headers.set('Cache-Control', 'no-store');
  return headers;
}

function isAuthorized(request: Request, config: McpHttpConfig) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken && config.urlToken && secureEqual(queryToken, config.urlToken)) return true;

  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ') && config.bearerToken) {
    return secureEqual(authorization.slice(7), config.bearerToken);
  }

  return false;
}

function configError(error: unknown) {
  return error instanceof Error ? error.message : 'Invalid server configuration.';
}

export async function serviceHandler() {
  return json(200, {
    service: 'portfolio-mcp',
    status: 'running',
    runtime: 'vercel-function',
    health: '/healthz',
    readiness: '/readyz',
    mcp: '/mcp',
  });
}

export async function healthHandler() {
  return json(200, {
    ok: true,
    service: 'portfolio-mcp',
    runtime: 'vercel-function',
    transport: 'streamable-http',
  });
}

export async function readinessHandler() {
  try {
    getAppConfig();
    getMcpHttpConfig();
    return json(200, { ready: true, service: 'portfolio-mcp' });
  } catch (error) {
    return json(503, {
      ready: false,
      service: 'portfolio-mcp',
      error: configError(error),
    });
  }
}

export async function mcpVercelHandler(request: Request) {
  let config: McpHttpConfig;

  try {
    getAppConfig();
    config = getMcpHttpConfig();
  } catch (error) {
    return json(503, {
      error: 'MCP server is not ready.',
      detail: configError(error),
    });
  }

  const headers = corsHeaders(request, config);
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && !getCorsOrigin(request, config)) {
    return json(403, { error: 'Origin not allowed' }, headers);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    headers.set('Allow', 'GET, POST, DELETE, OPTIONS');
    return json(405, { error: 'Method not allowed' }, headers);
  }

  if (!isAuthorized(request, config)) {
    headers.set('WWW-Authenticate', 'Bearer');
    return json(401, { error: 'Unauthorized' }, headers);
  }

  if (request.method === 'POST') {
    const rawContentLength = request.headers.get('content-length');
    if (rawContentLength) {
      const contentLength = Number(rawContentLength);
      if (Number.isFinite(contentLength) && contentLength > config.maxRequestBytes) {
        return json(413, { error: 'Request body too large' }, headers);
      }
    }
  }

  const response = await mcpHandler.fetch(request);
  const responseHeaders = new Headers(response.headers);
  for (const [name, value] of headers) responseHeaders.set(name, value);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
