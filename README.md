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
ChatGPT / MCP host / local MCP client
             |
             | Streamable HTTP or stdio
             v
      portfolio-mcp service
             |
             +--> token authentication (HTTP)
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

## Setup

```bash
git clone https://github.com/salman0butt/portfolio-mcp.git
cd portfolio-mcp
npm install
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
```

Generate strong random tokens with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice and use different values for the bearer token and URL token.

## Development

Remote HTTP mode:

```bash
npm run dev:http
```

The MCP endpoint is:

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

Stdio mode does not use HTTP tokens because access is controlled by the local process that launches the server.

## Production

Build and run directly:

```bash
npm run build
npm start
```

Or build the container:

```bash
docker build -t portfolio-mcp .
docker run --rm -p 3000:3000 --env-file .env portfolio-mcp
```

The service can run on a normal Node/container host such as Railway, Render, Fly.io, a VPS, Kubernetes, or another platform that supports long-lived Node HTTP processes.

## HTTP authentication

Clients that support request headers should use:

```http
Authorization: Bearer <PORTFOLIO_MCP_TOKEN>
```

For MCP clients where configuring a custom bearer header is inconvenient, the endpoint also accepts the disposable URL token:

```text
https://YOUR_MCP_HOST/mcp?token=PORTFOLIO_MCP_URL_TOKEN
```

Query-string credentials can appear in access logs. Treat `PORTFOLIO_MCP_URL_TOKEN` as disposable and rotate it if exposed. Prefer bearer authentication whenever the client supports it.

## CORS / origins

`MCP_ALLOWED_ORIGINS` accepts a comma-separated list:

```env
MCP_ALLOWED_ORIGINS=https://example.com,https://another-client.example
```

The default `*` is useful for MCP clients while authentication remains enforced by tokens. Tighten this list when you know the exact browser origins that must call the service.

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

## Image constraints

Accepted content types:

- PNG
- JPEG
- WebP
- GIF
- AVIF

Raw decoded uploads are limited to **3 MiB**. Storage paths are normalized and reject traversal such as `../`.

Recommended object paths:

```text
senior-software-engineer/cover.webp
production-rag-systems/architecture.webp
nextjs-at-scale/performance.webp
```

Deleting a blog article does not automatically delete its images. This avoids accidental deletion of media that may be shared or reused.

## Security model

- Supabase secret credentials are only read server-side.
- The Next.js portfolio keeps its public read-only Supabase access model.
- HTTP MCP requests require a bearer token or URL token.
- Token comparison uses timing-safe equality.
- No generic SQL/query executor is exposed.
- Slugs, publication dates, image paths, image types, and upload sizes are validated.
- Destructive tools are marked destructive in MCP metadata.
- Secrets must never be committed to GitHub.

## MCP protocol

The HTTP server uses the stable MCP TypeScript SDK v2 and exposes Streamable HTTP at `/mcp`. A stdio entrypoint is included for local MCP hosts.

## Validation

```bash
npm run typecheck
npm run build
```

GitHub Actions runs both commands for pull requests and pushes to `main`.
