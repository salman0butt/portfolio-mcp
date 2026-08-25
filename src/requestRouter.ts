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
 * Shared Web Request router used by tests and non-file-system entrypoints.
 *
 * Do not rename this file to src/server.ts. Vercel auto-detects
 * src/server.{js,ts,mjs,cjs} as a whole-project server entrypoint, which
 * bypasses the intended /api Vercel Functions and can produce an invalid
 * server export at runtime.
 */
export default async function requestRouter(request: Request): Promise<Response> {
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
