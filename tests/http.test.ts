import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { HttpConfig } from '../src/config.js';
import {
  closeNodeServer,
  createPortfolioHttpServer,
  type NodeMcpRequestHandler,
} from '../src/http.js';
import { createPortfolioMcpServer } from '../src/mcpFactory.js';

const bearerToken = 'b'.repeat(64);
const urlToken = 'u'.repeat(64);

const httpConfig: HttpConfig = {
  host: '127.0.0.1',
  port: 3000,
  bearerToken,
  urlToken,
  allowedOrigins: ['https://chatgpt.com'],
  maxRequestBytes: 128,
};

async function listenOnEphemeralPort(server: ReturnType<typeof createPortfolioHttpServer>) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

test('liveness stays available even when MCP environment configuration is invalid', async (t) => {
  const fakeHandler: NodeMcpRequestHandler = async (_req, res) => {
    res.statusCode = 200;
    res.end('ok');
  };
  const server = createPortfolioHttpServer(
    () => {
      throw new Error('PORTFOLIO_MCP_TOKEN is not configured.');
    },
    fakeHandler,
  );
  t.after(() => closeNodeServer(server));
  const baseUrl = await listenOnEphemeralPort(server);

  const root = await fetch(`${baseUrl}/`);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /portfolio-mcp/);

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: 'portfolio-mcp',
    transport: 'streamable-http',
  });

  const ready = await fetch(`${baseUrl}/readyz`);
  assert.equal(ready.status, 503);
  const readiness = await ready.json() as { ready: boolean; error: string };
  assert.equal(readiness.ready, false);
  assert.match(readiness.error, /not configured/);

  const mcp = await fetch(`${baseUrl}/mcp`, { method: 'GET' });
  assert.equal(mcp.status, 503);
  assert.match(await mcp.text(), /not configured/);
});

test('HTTP wrapper enforces auth, modern MCP CORS headers, and body limits', async (t) => {
  const fakeHandler: NodeMcpRequestHandler = async (_req, res, parsedBody) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, parsedBody }));
  };

  const server = createPortfolioHttpServer(httpConfig, fakeHandler);
  t.after(() => closeNodeServer(server));
  const baseUrl = await listenOnEphemeralPort(server);

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);

  const unauthorized = await fetch(`${baseUrl}/mcp`, { method: 'GET' });
  assert.equal(unauthorized.status, 401);

  const queryAuthorized = await fetch(`${baseUrl}/mcp?token=${urlToken}`, { method: 'GET' });
  assert.equal(queryAuthorized.status, 200);

  const bearerAuthorized = await fetch(`${baseUrl}/mcp`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  assert.equal(bearerAuthorized.status, 200);

  const preflight = await fetch(`${baseUrl}/mcp`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://chatgpt.com',
      'Access-Control-Request-Headers': 'mcp-method,mcp-name,mcp-protocol-version',
    },
  });
  assert.equal(preflight.status, 204);
  const allowedHeaders = preflight.headers.get('access-control-allow-headers') || '';
  assert.match(allowedHeaders, /mcp-method/i);
  assert.match(allowedHeaders, /mcp-name/i);

  const blockedOrigin = await fetch(`${baseUrl}/mcp?token=${urlToken}`, {
    method: 'GET',
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(blockedOrigin.status, 403);

  const oversized = await fetch(`${baseUrl}/mcp?token=${urlToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: 'x'.repeat(512) }),
  });
  assert.equal(oversized.status, 413);
});

test('remote MCP endpoint can answer tools/list for ChatGPT-style tool scanning', async (t) => {
  const mcpHandler = createMcpHandler(createPortfolioMcpServer, {
    responseMode: 'json',
    legacy: 'stateless',
  });
  const nodeHandler = toNodeHandler(mcpHandler) as NodeMcpRequestHandler;
  const server = createPortfolioHttpServer(
    { ...httpConfig, allowedOrigins: ['*'], maxRequestBytes: 1024 * 1024 },
    nodeHandler,
  );

  t.after(async () => {
    await closeNodeServer(server);
    await mcpHandler.close();
  });

  const baseUrl = await listenOnEphemeralPort(server);
  const response = await fetch(`${baseUrl}/mcp?token=${urlToken}`, {
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
  });

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /list_blog_posts/);
  assert.match(body, /create_blog_post/);
  assert.match(body, /publish_blog_post/);
  assert.match(body, /upload_blog_image/);
});
