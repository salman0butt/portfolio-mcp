# Portfolio MCP

Standalone Model Context Protocol (MCP) server for managing the Supabase-backed engineering blog used by Salman Butt's portfolio.

The public Next.js portfolio remains read-only. This service owns the privileged blog-management surface and keeps the Supabase secret key outside the frontend deployment.

## Tools

Article tools:

- `list_blog_posts`
- `get_blog_post`
- `create_blog_post`
- `update_blog_post`
- `publish_blog_post`
- `unpublish_blog_post`
- `delete_blog_post`

Image tools:

- `upload_blog_image`
- `replace_blog_image`
- `delete_blog_image`
- `get_blog_image_url`

The server does **not** expose arbitrary SQL or unrestricted Supabase access.

## Deployment modes

This repository supports two production deployment models:

1. **Vercel Functions** — explicit `api/*` Web handlers with rewrites for `/`, `/healthz`, `/readyz`, and `/mcp`.
2. **Long-running Node/Docker** — `src/http.ts` for Railway, Render, Fly.io, Kubernetes, a VPS, or Docker.

Both modes use the same MCP SDK v2 tool definitions and Supabase access layer.

## Requirements

- Node.js 22+
- A Supabase project containing the portfolio `blogs` table
- A server-side Supabase secret key with access to the blog table and Storage bucket
- For ChatGPT: an HTTPS-accessible remote deployment

## Environment variables

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_REPLACE_ME
SUPABASE_BLOG_BUCKET=blog-images

PORTFOLIO_MCP_TOKEN=replace-with-long-random-bearer-token
PORTFOLIO_MCP_URL_TOKEN=replace-with-different-long-random-url-token

MCP_ALLOWED_ORIGINS=*
MCP_MAX_REQUEST_BYTES=4000000
```

For the standalone Node server you may additionally set:

```env
PORT=3000
HOST=0.0.0.0
```

Do not manually set `PORT` or `HOST` for the Vercel Function deployment.

Generate the two MCP tokens separately:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice and use different values. Both tokens must be at least 32 characters.

Never use `SUPABASE_SECRET_KEY` as an MCP token and never place the Supabase secret in a ChatGPT connector URL.

## Supabase authentication

Prefer the modern Supabase server-side secret key:

```text
sb_secret_...
```

Modern `sb_secret_*` keys are sent only in the Supabase `apikey` header. They are opaque API keys and are not sent as JWT bearer tokens. Legacy JWT-based `service_role` keys remain supported for migration compatibility.

## Vercel deployment

The Vercel deployment uses explicit Function entrypoints:

```text
api/index.ts    -> /
api/healthz.ts  -> /healthz
api/readyz.ts   -> /readyz
api/mcp.ts      -> /mcp
```

`vercel.json` contains the rewrites and MCP function duration configuration.

Import the GitHub repository into Vercel, select the **Other** framework preset if Vercel asks for one, configure the environment variables above for Production, and deploy the latest `main` branch.

Do not configure a custom Output Directory. The repository's `vercel.json` and `api/*` Functions define the deployment surface.

### Vercel verification

After deployment, test in this order:

```text
https://YOUR_HOST/
https://YOUR_HOST/healthz
https://YOUR_HOST/readyz
```

`/` should return a service document.

`/healthz` is a liveness check and should return HTTP 200 even if Supabase/MCP environment configuration is incomplete:

```json
{
  "ok": true,
  "service": "portfolio-mcp",
  "runtime": "vercel-function",
  "transport": "streamable-http"
}
```

`/readyz` validates the Supabase and MCP environment configuration. A valid deployment returns HTTP 200:

```json
{
  "ready": true,
  "service": "portfolio-mcp"
}
```

An invalid configuration returns HTTP 503 with a safe diagnostic, for example:

```json
{
  "ready": false,
  "service": "portfolio-mcp",
  "error": "SUPABASE_URL is not configured."
}
```

`/mcp` without authentication should return HTTP 401 when configuration is valid.

For Vercel, keep `MCP_MAX_REQUEST_BYTES` at or below the platform request-body limit. `4000000` is the recommended value for this deployment. Large media should not be transported as large base64 MCP requests.

## Standalone Node / Docker deployment

Install and run locally:

```bash
git clone https://github.com/salman0butt/portfolio-mcp.git
cd portfolio-mcp
npm ci
cp .env.example .env
npm run dev:http
```

Production Node process:

```bash
npm run build
npm start
```

Docker:

```bash
docker build -t portfolio-mcp .
docker run --rm -p 3000:3000 --env-file .env portfolio-mcp
```

The container installs dependencies from `package-lock.json`, runs as the non-root `node` user, and exposes a `/healthz` Docker health check.

## HTTP authentication

Clients that support request headers should use:

```http
Authorization: Bearer <PORTFOLIO_MCP_TOKEN>
```

For clients where a static bearer header is inconvenient, the server also accepts the disposable URL token:

```text
https://YOUR_MCP_HOST/mcp?token=YOUR_PORTFOLIO_MCP_URL_TOKEN
```

Query-string credentials can appear in infrastructure/access logs. Treat `PORTFOLIO_MCP_URL_TOKEN` as disposable and rotate it if exposed. Prefer bearer authentication whenever possible.

## Connect to ChatGPT

ChatGPT connects to a **remote HTTPS MCP server**, not localhost.

For a ChatGPT connector UI that does not provide a static custom bearer-header field, use:

```text
https://YOUR_MCP_HOST/mcp?token=YOUR_PORTFOLIO_MCP_URL_TOKEN
```

Then choose **No Auth** in ChatGPT. Authentication is still enforced by this MCP server through the URL token.

Use **Scan Tools**. The server should expose the article and image tools listed above.

Recommended test sequence:

```text
List my portfolio blog posts.
```

Then:

```text
Create a draft blog post titled "MCP Connection Test". Do not publish it.
```

Verify it, then delete the test draft only when you explicitly intend to remove it.

Do not enter `SUPABASE_SECRET_KEY` into ChatGPT.

## CORS

`MCP_ALLOWED_ORIGINS` accepts a comma-separated list:

```env
MCP_ALLOWED_ORIGINS=https://example.com,https://another-client.example
```

The remote handlers support current MCP request headers including `Mcp-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, and `Mcp-Session-Id` in browser CORS preflights.

The default `*` maximizes compatibility while token authentication remains mandatory.

## Image constraints

Accepted content types:

- PNG
- JPEG
- WebP
- GIF
- AVIF

Decoded image uploads are limited to 3 MiB. Storage paths are normalized and reject traversal such as `../`, and image payloads must contain valid base64.

Recommended object paths:

```text
senior-software-engineer/cover.webp
production-rag-systems/architecture.webp
nextjs-at-scale/performance.webp
```

Deleting a blog article does not automatically delete its images.

## Security model

- Supabase secret credentials remain server-side.
- Modern `sb_secret_*` keys are sent as Supabase API keys, not JWT bearer tokens.
- The public Next.js portfolio remains read-only.
- HTTP MCP requests require a bearer token or URL token.
- MCP tokens must be strong and distinct.
- Token comparison uses timing-safe equality.
- No generic SQL/query executor is exposed.
- Slugs, publication dates, image paths, image types, base64 payloads, image sizes, and HTTP request sizes are validated.
- Overwrite, unpublish, replace, and delete tools use risk-appropriate MCP annotations.
- Secrets must never be committed to GitHub.

## Validation

Run the same application validation used by CI:

```bash
npm run check
```

This runs strict TypeScript typechecking, runtime tests, and the production TypeScript build. The TypeScript project includes both `src/**/*.ts` and `api/**/*.ts`, so Vercel Function entrypoints are validated in CI.

GitHub Actions also builds the production Docker image and installs the exact dependency graph with `npm ci`.
