export type AppConfig = {
  supabaseUrl: string;
  supabaseSecretKey: string;
  blogBucket: string;
};

export type HttpConfig = {
  host: string;
  port: number;
  bearerToken: string | null;
  urlToken: string | null;
  allowedOrigins: string[];
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function optional(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

export function getAppConfig(): AppConfig {
  return {
    supabaseUrl: required('SUPABASE_URL').replace(/\/$/, ''),
    supabaseSecretKey: required('SUPABASE_SECRET_KEY'),
    blogBucket: process.env.SUPABASE_BLOG_BUCKET?.trim() || 'blog-images',
  };
}

export function getHttpConfig(): HttpConfig {
  const rawPort = process.env.PORT?.trim() || '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const bearerToken = optional('PORTFOLIO_MCP_TOKEN');
  const urlToken = optional('PORTFOLIO_MCP_URL_TOKEN');
  if (!bearerToken && !urlToken) {
    throw new Error('Configure PORTFOLIO_MCP_TOKEN, PORTFOLIO_MCP_URL_TOKEN, or both for HTTP mode.');
  }

  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS || '*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    host: process.env.HOST?.trim() || '0.0.0.0',
    port,
    bearerToken,
    urlToken,
    allowedOrigins,
  };
}
