export function GET(_request: Request) {
  return Response.json(
    {
      service: 'portfolio-mcp',
      status: 'running',
      runtime: 'vercel-function',
      health: '/healthz',
      readiness: '/readyz',
      mcp: '/mcp',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
