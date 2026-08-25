import { loadEnvFile } from 'node:process';

export type AppConfig = {
  supabaseUrl: string;
  supabaseSecretKey: string;
  blogBucket: string;
};

export type HttpListenConfig = {
  host: string;
  port: number;
};

export type McpHttpConfig = {
  bearerToken: string | null;
  urlToken: string | null;
  allowedOrigins: string[];
  maxRequestBytes: number;
};

export type HttpConfig = HttpListenConfig & McpHttpConfig;

const DEFAULT_MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const MIN_TOKEN_LENGTH = 32;

export function loadLocalEnvFile(path = '.env') {
  try {
    loadEnvFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function optional(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function validateToken(name: string, value: string | null) {
  if (value && value.length < MIN_TOKEN_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_TOKEN_LENGTH} characters.`);
  }
}

export function getAppConfig(): AppConfig {
  return {
    supabaseUrl: required('SUPABASE_URL').replace(/\/$/, ''),
    supabaseSecretKey: required('SUPABASE_SECRET_KEY'),
    blogBucket: process.env.SUPABASE_BLOG_BUCKET?.trim() || 'blog-images',
  };
}

export function getHttpListenConfig(): HttpListenConfig {
  const rawPort = process.env.PORT?.trim() || '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return {
    host: process.env.HOST?.trim() || '0.0.0.0',
    port,
  };
}

export function getMcpHttpConfig(): McpHttpConfig {
  const bearerToken = optional('PORTFOLIO_MCP_TOKEN');
  const urlToken = optional('PORTFOLIO_MCP_URL_TOKEN');
  if (!bearerToken && !urlToken) {
    throw new Error('Configure PORTFOLIO_MCP_TOKEN, PORTFOLIO_MCP_URL_TOKEN, or both for HTTP mode.');
  }

  validateToken('PORTFOLIO_MCP_TOKEN', bearerToken);
  validateToken('PORTFOLIO_MCP_URL_TOKEN', urlToken);
  if (bearerToken && urlToken && bearerToken === urlToken) {
    throw new Error('PORTFOLIO_MCP_TOKEN and PORTFOLIO_MCP_URL_TOKEN must use different values.');
  }

  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS || '*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const rawMaxRequestBytes = process.env.MCP_MAX_REQUEST_BYTES?.trim() || String(DEFAULT_MAX_REQUEST_BYTES);
  const maxRequestBytes = Number(rawMaxRequestBytes);
  if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 64 * 1024 || maxRequestBytes > 20 * 1024 * 1024) {
    throw new Error('MCP_MAX_REQUEST_BYTES must be an integer between 65536 and 20971520.');
  }

  return {
    bearerToken,
    urlToken,
    allowedOrigins,
    maxRequestBytes,
  };
}

export function getHttpConfig(): HttpConfig {
  return {
    ...getHttpListenConfig(),
    ...getMcpHttpConfig(),
  };
}
