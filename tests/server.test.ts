import assert from 'node:assert/strict';
import test from 'node:test';
import server from '../src/server.js';

test('Vercel server default export handles liveness routes', async () => {
  assert.equal(typeof server, 'function');

  const root = await server(new Request('https://portfolio.example/'));
  assert.equal(root.status, 200);
  assert.match(await root.text(), /portfolio-mcp/);

  const health = await server(new Request('https://portfolio.example/healthz'));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: 'portfolio-mcp',
    runtime: 'vercel-function',
    transport: 'streamable-http',
  });

  const missing = await server(new Request('https://portfolio.example/not-found'));
  assert.equal(missing.status, 404);
});
