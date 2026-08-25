import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  IMAGE_TYPES,
  cleanTags,
  createPost,
  deleteImage,
  deletePost,
  getPost,
  getPublicImageUrl,
  listPosts,
  normalizePublishedAt,
  patchPost,
  uploadImage,
} from './supabase.js';

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase kebab-case slug.');

const publicationDateSchema = z
  .string()
  .min(1)
  .describe('ISO 8601 date or datetime, e.g. 2026-08-25 or 2026-08-25T12:00:00+05:00.');

function toolSuccess(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
    isError: false,
  };
}

function toolFailure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown tool error';
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

async function runTool<T>(operation: () => Promise<T> | T) {
  try {
    return toolSuccess(await operation());
  } catch (error) {
    console.error('[portfolio-mcp] tool failed', error);
    return toolFailure(error);
  }
}

export function createPortfolioMcpServer() {
  const server = new McpServer(
    { name: 'salman-portfolio-mcp', version: '3.0.1' },
    {
      instructions:
        'Manage Salman Butt portfolio engineering articles and blog images. Preserve factual content, prefer drafts when review is appropriate, and only overwrite, unpublish, replace, or delete content when the user explicitly intends that change.',
    },
  );

  server.registerTool(
    'list_blog_posts',
    {
      title: 'List blog posts',
      description: 'List portfolio blog posts, including drafts when requested.',
      inputSchema: z
        .object({
          state: z.enum(['all', 'published', 'draft']).default('all'),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ state, limit }) => runTool(() => listPosts(state, limit)),
  );

  server.registerTool(
    'get_blog_post',
    {
      title: 'Get blog post',
      description: 'Get one portfolio blog post by slug, including its full Markdown content.',
      inputSchema: z.object({ slug: slugSchema }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ slug }) => runTool(() => getPost(slug)),
  );

  server.registerTool(
    'create_blog_post',
    {
      title: 'Create blog post',
      description: 'Create a portfolio article. Defaults to a draft and supports a custom publication date.',
      inputSchema: z
        .object({
          title: z.string().min(1).max(180),
          slug: slugSchema,
          excerpt: z.string(),
          content: z.string(),
          cover_image_url: z.string().url().nullable().optional(),
          category: z.string().nullable().optional(),
          tags: z.array(z.string()).max(30).default([]),
          featured: z.boolean().default(false),
          published: z.boolean().default(false),
          published_at: publicationDateSchema.optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => runTool(() => createPost(input)),
  );

  server.registerTool(
    'update_blog_post',
    {
      title: 'Update blog post',
      description: 'Update an existing article, including its slug, Markdown, metadata, image URL, or publication date.',
      inputSchema: z
        .object({
          slug: slugSchema,
          title: z.string().min(1).max(180).optional(),
          new_slug: slugSchema.optional(),
          excerpt: z.string().optional(),
          content: z.string().optional(),
          cover_image_url: z.string().url().nullable().optional(),
          category: z.string().nullable().optional(),
          tags: z.array(z.string()).max(30).optional(),
          featured: z.boolean().optional(),
          published_at: publicationDateSchema.optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ slug, new_slug, published_at, ...changes }) =>
      runTool(async () => {
        const patch: Record<string, unknown> = { ...changes };
        if (new_slug) patch.slug = new_slug;
        if (changes.tags) patch.tags = cleanTags(changes.tags);
        if (published_at) patch.published_at = normalizePublishedAt(published_at);
        return patchPost(slug, patch);
      }),
  );

  server.registerTool(
    'publish_blog_post',
    {
      title: 'Publish blog post',
      description: 'Publish an existing draft, optionally using a custom publication date.',
      inputSchema: z
        .object({
          slug: slugSchema,
          published_at: publicationDateSchema.optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ slug, published_at }) =>
      runTool(() =>
        patchPost(slug, {
          published: true,
          ...(published_at ? { published_at: normalizePublishedAt(published_at) } : {}),
        }),
      ),
  );

  server.registerTool(
    'unpublish_blog_post',
    {
      title: 'Unpublish blog post',
      description: 'Remove an article from the public blog while keeping it in Supabase.',
      inputSchema: z.object({ slug: slugSchema }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ slug }) => runTool(() => patchPost(slug, { published: false })),
  );

  server.registerTool(
    'delete_blog_post',
    {
      title: 'Delete blog post',
      description: 'Permanently delete an article by slug. Images are managed separately.',
      inputSchema: z.object({ slug: slugSchema }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ slug }) => runTool(() => deletePost(slug)),
  );

  server.registerTool(
    'upload_blog_image',
    {
      title: 'Upload blog image',
      description: 'Upload a new PNG, JPEG, WebP, GIF, or AVIF image to the configured public blog bucket.',
      inputSchema: z
        .object({
          path: z.string().min(1),
          content_type: z.enum(IMAGE_TYPES),
          base64: z.string().min(1),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ path, content_type, base64 }) =>
      runTool(() => uploadImage({ path, content_type, base64, upsert: false })),
  );

  server.registerTool(
    'replace_blog_image',
    {
      title: 'Replace blog image',
      description: 'Replace an existing blog image at the same Storage path.',
      inputSchema: z
        .object({
          path: z.string().min(1),
          content_type: z.enum(IMAGE_TYPES),
          base64: z.string().min(1),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, content_type, base64 }) =>
      runTool(() => uploadImage({ path, content_type, base64, upsert: true })),
  );

  server.registerTool(
    'delete_blog_image',
    {
      title: 'Delete blog image',
      description: 'Permanently delete one image from the configured blog Storage bucket.',
      inputSchema: z.object({ path: z.string().min(1) }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path }) => runTool(() => deleteImage(path)),
  );

  server.registerTool(
    'get_blog_image_url',
    {
      title: 'Get blog image URL',
      description: 'Return the public URL for an object in the configured blog Storage bucket.',
      inputSchema: z.object({ path: z.string().min(1) }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path }) => runTool(() => getPublicImageUrl(path)),
  );

  return server;
}
