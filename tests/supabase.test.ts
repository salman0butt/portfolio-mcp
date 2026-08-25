import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSupabaseHeaders, listPosts } from '../src/supabase.js';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('new sb_secret keys are sent on apikey only', () => {
  const headers = buildSupabaseHeaders('sb_secret_example-key-value');

  assert.equal(headers.get('apikey'), 'sb_secret_example-key-value');
  assert.equal(headers.get('authorization'), null);
});

test('legacy JWT service-role keys keep Bearer authorization compatibility', () => {
  const legacyKey = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature';
  const headers = buildSupabaseHeaders(legacyKey);

  assert.equal(headers.get('apikey'), legacyKey);
  assert.equal(headers.get('authorization'), `Bearer ${legacyKey}`);
});

test('Supabase Data API request never sends sb_secret as Bearer', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  const originalBucket = process.env.SUPABASE_BLOG_BUCKET;
  const originalFetch = globalThis.fetch;

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_runtime-test-key';
  process.env.SUPABASE_BLOG_BUCKET = 'blog-images';

  let capturedHeaders: Headers | null = null;
  globalThis.fetch = async (_input, init) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await listPosts('all', 1);
    assert.equal(capturedHeaders?.get('apikey'), 'sb_secret_runtime-test-key');
    assert.equal(capturedHeaders?.get('authorization'), null);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('SUPABASE_URL', originalUrl);
    restoreEnv('SUPABASE_SECRET_KEY', originalKey);
    restoreEnv('SUPABASE_BLOG_BUCKET', originalBucket);
  }
});
