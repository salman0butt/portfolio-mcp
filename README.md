# Portfolio MCP

Standalone Model Context Protocol (MCP) server for managing the Supabase-backed engineering blog used by Salman Butt's portfolio.

The public Next.js portfolio remains read-only. This service owns the privileged blog-management surface and keeps the Supabase secret key outside the frontend deployment.

## What it exposes

### Article tools

- `list_blog_posts`
- `get_blog_post`
- `create_blog_post`
- `update_blog_post`
- `publish_blog_post`
- `unpublish_blog_post`
- `delete_blog_post`

### Image tools

- `upload_blog_image`
- `replace_blog_image`
- `delete_blog_image`
- `get_blog_image_url`

The server does **not** expose arbitrary SQL or unrestricted Supabase access.

## Architecture

```text
ChatGPT / remote MCP host / local MCP client
             |
             | Streamable HTTP or stdio
             v
      portfolio-mcp service
             |
             +--> MCP token authentication (HTTP)
             |
             +--> MCP SDK v2 tool layer
             |
             +--> Supabase REST: public.blogs
             |
             +--> Supabase Storage: blog-images

Public visitors
      |
      v
Next.js portfolio --> Supabase anon read-only access
```

## Requirements

- Node.js 22+
- A Supabase project containing the portfolio `blogs` table
- A server-side Supabase secret key with access to the blog table and Storage bucket
- For ChatGPT: an HTTPS-accessible **remote** deployment of this MCP server

## Setup

```bash
git clone https://github.com/salman0butt/portfolio-mcp.git
cd portfolio-mcp
npm ci
cp .env.example .env
```

Configure `.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_REPLACE_ME
SUPABASE_BLOG_BUCKET=blog-images

PORTFOLIO_MCP_TOKEN=replace-with-long-random-bearer-token
PORTFOLIO_MCP_URL_TOKEN=replace-with-different-long-random-url-token

PORT=3000
HOST=0.0.0.0
MCP_ALLOWED_ORIGINS=*
MCP_MAX_REQUEST_BYTES=5242880
```

The HTTP and stdio entrypoints automatically load a local `.env` file when present. Environment variables injected by your deployment platform continue to work normally.

### Generate the MCP tokens

Run this command twice:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use two different outputs:

- `PORTFOLIO_MCP_TOKEN` — bearer token for clients that can send `Authorization` headers.
- `PORTFOLIO_MCP_URL_TOKEN` — disposable token for clients where a static custom header is inconvenient.

Both tokens must be at least 32 characters and must be different.

**Never** use the Supabase secret key as an MCP token. Never put `SUPABASE_SECRET_KEY` in a ChatGPT connector URL.

## Supabase authentication

Prefer the modern Supabase server-side secret key:

```text
sb_secret_...
```

The service sends modern `sb_secret_*` keys only in the Supabase `apikey` header. These keys are opaque API keys and are **not** sent as `Authorization: Bearer` JWTs.

Legacy JWT-based `service_role` keys remain supported for migration compatibility, but new deployments should use `sb_secret_*`.

## Development

Remote HTTP mode:

```bash
npm run dev:http
```

MCP endpoint:

```text
http://localhost:3000/mcp
```

Health check:

```text
http://localhost:3000/healthz
```

Local stdio mode:

```bash
npm run dev:stdio
```

Stdio mode does not use HTTP MCP tokens because access is controlled by the local process launching the server.

## Production deployment

Build and run directly:

```bash
npm run build
npm start
```

Or use Docker:

```bash
docker build -t portfolio-mcp .
docker run --rm -p 3000:3000 --env-file .env portfolio-mcp
```

The container installs dependencies from `package-lock.json`, runs as the non-root `node` user, and exposes a `/healthz` Docker health check.

Deploy this service to a platform that supports a long-running Node HTTP process/container, such as Railway, Render, Fly.io, Kubernetes, or a VPS. The current implementation is **not** a Vercel serverless-function entrypoint.

For ChatGPT, the deployed MCP endpoint must be reachable over HTTPS, for example:

```text
https://portfolio-mcp.example.com/mcp
```

## HTTP authentication

Clients that support request headers should use:

```http
Authorization: Bearer <PORTFOLIO_MCP_TOKEN>
```

For a client where configuring a static bearer header is inconvenient, the endpoint also accepts:

```text
https://YOUR_MCP_HOST/mcp?token=YOUR_PORTFOLIO_MCP_URL_TOKEN
```

Query-string credentials can appear in infrastructure/access logs. Treat `PORTFOLIO_MCP_URL_TOKEN` as disposable and rotate it if exposed. Prefer bearer authentication when the MCP client supports it.

## Connect to ChatGPT

ChatGPT connects to **remote** MCP servers, not a server running only on `localhost`.

At the time of this repository update (August 2026), OpenAI documents full custom MCP support including write/modify actions for ChatGPT Business, Enterprise, and Edu workspaces on the web. Availability can change, so check the current OpenAI ChatGPT custom-app/MCP documentation if your UI differs.

When your ChatGPT workspace exposes custom MCP apps/connectors:

1. Deploy this repository to an HTTPS endpoint.
2. Configure all server environment variables on the deployment platform.
3. In ChatGPT, enable Developer Mode / custom apps according to your workspace permissions.
4. Create a custom MCP app.
5. If the ChatGPT form does not provide a static custom bearer-header field, use the URL-token endpoint:

   ```text
   https://YOUR_MCP_HOST/mcp?token=YOUR_PORTFOLIO_MCP_URL_TOKEN
   ```

6. Select **No Auth** in ChatGPT for that connector. Authentication is still enforced by this server through the URL token.
7. Choose **Scan Tools**. The server should expose the article and image tools listed above.
8. Add/enable the app in a new chat and test a read action such as `list_blog_posts` before testing a write action.
9. ChatGPT may request confirmation for write/destructive actions based on workspace/app permissions and the tool annotations.

Do not enter `SUPABASE_SECRET_KEY` into ChatGPT. ChatGPT only needs the remote MCP endpoint (and, with this URL-token setup, the disposable MCP URL token).

### Recommended ChatGPT test sequence

After the connector scans successfully:

```text
List my portfolio blog posts.
```

Then:

```text
Create a draft blog post titled "MCP Connection Test". Do not publish it.
```

Then verify it:

```text
Get the MCP Connection Test draft and show me its metadata.
```

Finally delete the test draft only when you explicitly intend to remove it.

## CORS / origins

`MCP_ALLOWED_ORIGINS` accepts a comma-separated list:

```env
MCP_ALLOWED_ORIGINS=https://example.com,https://another-client.example
```

The HTTP server supports current MCP request headers including `Mcp-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, and `Mcp-Session-Id` in browser CORS preflights.

The default `*` maximizes compatibility while token authentication remains mandatory. Tighten the list when you know the exact browser origins that must call the service.

## Request and image limits

The default HTTP MCP request ceiling is **5 MiB**:

```env
MCP_MAX_REQUEST_BYTES=5242880
```

This is intentionally larger than the **3 MiB decoded image limit** because base64 adds roughly one-third overhead plus JSON framing.

Accepted image content types:

- PNG
- JPEG
- WebP
- GIF
- AVIF

Storage paths are normalized and reject traversal such as `../`. Image payloads must contain valid base64.

Recommended object paths:

```text
senior-software-engineer/cover.webp
production-rag-systems/architecture.webp
nextjs-at-scale/performance.webp
```

Deleting a blog article does not automatically delete its images. This avoids accidental deletion of media that may be shared or reused.

## Blog workflow

Recommended publishing flow:

1. Create the article as a draft.
2. Upload cover/diagram images if needed.
3. Update the draft with the returned public image URLs.
4. Review title, excerpt, Markdown, category, tags, and publication date.
5. Publish using `publish_blog_post`.
6. Update or unpublish later when needed.
7. Only delete the article or images when explicitly intended.

`published_at` accepts an ISO 8601 date or datetime, for example:

```text
2026-08-25
2026-08-25T12:00:00+05:00
```

## Security model

- Supabase secret credentials are server-side only.
- Modern `sb_secret_*` keys are sent as Supabase API keys, not JWT bearer tokens.
- The Next.js portfolio keeps its public read-only Supabase access model.
- HTTP MCP requests require a bearer token or URL token.
- MCP tokens must be strong and distinct.
- Token comparison uses timing-safe equality.
- No generic SQL/query executor is exposed.
- Slugs, publication dates, image paths, image types, base64 payloads, image sizes, and HTTP request sizes are validated.
- Overwrite, unpublish, replace, and delete tools use risk-appropriate MCP annotations.
- Shutdown stops accepting new traffic and gives active requests a bounded drain period before MCP resources are closed.
- Secrets must never be committed to GitHub.

## MCP protocol

The HTTP server uses the stable MCP TypeScript SDK v2 and exposes Streamable HTTP at `/mcp`. A stdio entrypoint is included for local MCP hosts.

The remote HTTP wrapper supports both modern MCP traffic and the SDK's stateless legacy fallback to maximize client compatibility.

## Validation

Run the same validation used by CI:

```bash
npm run check
```

This runs:

- strict TypeScript typechecking
- runtime regression tests
- production TypeScript build

Runtime tests cover Supabase secret-key handling, HTTP authentication, CORS, request limits, environment loading, token validation, and a real MCP `tools/list` request through the remote HTTP adapter.

GitHub Actions installs the exact dependency graph with `npm ci` from the committed lockfile.
