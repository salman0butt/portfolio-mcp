import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getHttpConfig, loadLocalEnvFile } from '../src/config.js';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('local .env files are loaded by the runtime', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'portfolio-mcp-env-'));
  const envPath = join(dir, '.env');
  const original = process.env.PORTFOLIO_MCP_ENV_TEST;
  delete process.env.PORTFOLIO_MCP_ENV_TEST;

  try {
    await writeFile(envPath, 'PORTFOLIO_MCP_ENV_TEST=loaded\n', 'utf8');
    loadLocalEnvFile(envPath);
    assert.equal(process.env.PORTFOLIO_MCP_ENV_TEST, 'loaded');
  } finally {
    restoreEnv('PORTFOLIO_MCP_ENV_TEST', original);
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTP configuration rejects weak or reused MCP tokens', () => {
  const originalBearer = process.env.PORTFOLIO_MCP_TOKEN;
  const originalUrl = process.env.PORTFOLIO_MCP_URL_TOKEN;
  const originalMax = process.env.MCP_MAX_REQUEST_BYTES;

  try {
    process.env.PORTFOLIO_MCP_TOKEN = 'too-short';
    delete process.env.PORTFOLIO_MCP_URL_TOKEN;
    assert.throws(() => getHttpConfig(), /at least 32 characters/);

    const shared = 's'.repeat(64);
    process.env.PORTFOLIO_MCP_TOKEN = shared;
    process.env.PORTFOLIO_MCP_URL_TOKEN = shared;
    assert.throws(() => getHttpConfig(), /must use different values/);

    process.env.PORTFOLIO_MCP_TOKEN = 'b'.repeat(64);
    process.env.PORTFOLIO_MCP_URL_TOKEN = 'u'.repeat(64);
    process.env.MCP_MAX_REQUEST_BYTES = String(5 * 1024 * 1024);
    const config = getHttpConfig();
    assert.equal(config.maxRequestBytes, 5 * 1024 * 1024);
  } finally {
    restoreEnv('PORTFOLIO_MCP_TOKEN', originalBearer);
    restoreEnv('PORTFOLIO_MCP_URL_TOKEN', originalUrl);
    restoreEnv('MCP_MAX_REQUEST_BYTES', originalMax);
  }
});
