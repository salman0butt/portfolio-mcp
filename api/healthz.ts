export function GET(_request: Request) {
  return Response.json(
    {
      ok: true,
      service: 'portfolio-mcp',
      runtime: 'vercel-function',
      transport: 'streamable-http',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
