import assert from 'node:assert/strict';
import test from 'node:test';
import {
  healthHandler,
  mcpVercelHandler,
  readinessHandler,
  serviceHandler,
} from '../src/vercel.js';

const ENV_NAMES = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_BLOG_BUCKET',
  'PORTFOLIO_MCP_TOKEN',
  'PORTFOLIO_MCP_URL_TOKEN',
  'MCP_ALLOWED_ORIGINS',
  'MCP_MAX_REQUEST_BYTES',
] as const;

function snapshotEnv() {
  return Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const name of ENV_NAMES) {
    const value = snapshot[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function clearConfigEnv() {
  for (const name of ENV_NAMES) delete process.env[name];
}

test('Vercel liveness routes do not depend on secrets', async () => {
  const snapshot = snapshotEnv();
  try {
    clearConfigEnv();

    const root = await serviceHandler();
    assert.equal(root.status, 200);
    assert.match(await root.text(), /vercel-function/);

    const health = await healthHandler();
    assert.equal(health.status, 200);
    assert.match(await health.text(), /streamable-http/);

    const ready = await readinessHandler();
    assert.equal(ready.status, 503);
    assert.match(await ready.text(), /SUPABASE_URL is not configured/);
  } finally {
    restoreEnv(snapshot);
  }
});

test('Vercel MCP route enforces readiness and authentication', async () => {
  const snapshot = snapshotEnv();
  try {
    clearConfigEnv();

    const notReady = await mcpVercelHandler(
      new Request('https://portfolio.example/mcp', { method: 'GET' }),
    );
    assert.equal(notReady.status, 503);

    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = `sb_secret_${'s'.repeat(40)}`;
    process.env.SUPABASE_BLOG_BUCKET = 'blog-images';
    process.env.PORTFOLIO_MCP_TOKEN = 'b'.repeat(64);
    process.env.PORTFOLIO_MCP_URL_TOKEN = 'u'.repeat(64);
    process.env.MCP_ALLOWED_ORIGINS = '*';
    process.env.MCP_MAX_REQUEST_BYTES = '4000000';

    const ready = await readinessHandler();
    assert.equal(ready.status, 200);

    const unauthorized = await mcpVercelHandler(
      new Request('https://portfolio.example/mcp', { method: 'GET' }),
    );
    assert.equal(unauthorized.status, 401);

    for (const queryToken of ['u'.repeat(64), 'b'.repeat(64)]) {
      const response = await mcpVercelHandler(
        new Request(`https://portfolio.example/mcp?token=${queryToken}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'Mcp-Protocol-Version': '2025-06-18',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {},
          }),
        }),
      );

      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /list_blog_posts/);
      assert.match(body, /create_blog_post/);
      assert.match(body, /publish_blog_post/);
    }
  } finally {
    restoreEnv(snapshot);
  }
});
