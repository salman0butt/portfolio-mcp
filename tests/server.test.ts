import assert from 'node:assert/strict';
import test from 'node:test';
import requestRouter from '../src/requestRouter.js';

test('request router handles liveness routes', async () => {
  assert.equal(typeof requestRouter, 'function');

  const root = await requestRouter(new Request('https://portfolio.example/'));
  assert.equal(root.status, 200);
  assert.match(await root.text(), /portfolio-mcp/);

  const health = await requestRouter(new Request('https://portfolio.example/healthz'));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: 'portfolio-mcp',
    runtime: 'vercel-function',
    transport: 'streamable-http',
  });

  const missing = await requestRouter(new Request('https://portfolio.example/not-found'));
  assert.equal(missing.status, 404);
});
