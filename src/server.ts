import {
  healthHandler,
  mcpVercelHandler,
  readinessHandler,
  serviceHandler,
} from './vercel.js';

function notFound() {
  return Response.json(
    { error: 'Not found' },
    {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

/**
 * Vercel application server entrypoint.
 *
 * Vercel detects src/server.ts and requires its default export to be a
 * callable/server. Keep MCP tool registration in mcpFactory.ts so this file
 * remains an HTTP routing boundary rather than an MCP factory module.
 */
export default async function server(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === 'GET' && pathname === '/') {
    return serviceHandler();
  }

  if (request.method === 'GET' && pathname === '/healthz') {
    return healthHandler();
  }

  if (request.method === 'GET' && pathname === '/readyz') {
    return readinessHandler();
  }

  if (pathname === '/mcp' || pathname === '/mcp/') {
    return mcpVercelHandler(request);
  }

  return notFound();
}
