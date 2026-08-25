import { getAppConfig } from './config.js';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] as const;
export type ImageContentType = (typeof IMAGE_TYPES)[number];

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const BLOG_FIELDS = 'id,title,slug,excerpt,content,cover_image_url,category,tags,featured,published,published_at,created_at,updated_at';

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_image_url: string | null;
  category: string | null;
  tags: string[];
  featured: boolean;
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateBlogPostInput = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_image_url?: string | null;
  category?: string | null;
  tags: string[];
  featured: boolean;
  published: boolean;
  published_at?: string;
};

async function supabaseFetch(path: string, init: RequestInit = {}) {
  const { supabaseUrl, supabaseSecretKey } = getAppConfig();
  const headers = new Headers(init.headers);
  headers.set('apikey', supabaseSecretKey);
  headers.set('Authorization', `Bearer ${supabaseSecretKey}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${detail.slice(0, 700)}`);
  }

  return response;
}

export function cleanTags(value: string[]) {
  return value
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function normalizePublishedAt(value: string) {
  const raw = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00.000Z`)
    : new Date(raw);

  if (Number.isNaN(date.getTime())) {
    throw new Error('published_at must be a valid ISO 8601 date or datetime.');
  }

  return date.toISOString();
}

function normalizeObjectPath(value: string) {
  const raw = value.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  const segments = raw.split('/');

  if (!raw || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid storage path.');
  }

  if (!/^[a-zA-Z0-9._/-]+$/.test(raw)) {
    throw new Error('Storage path may only contain letters, numbers, dots, underscores, hyphens, and slashes.');
  }

  return raw;
}

function encodeObjectPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function getPublicImageUrl(pathValue: string) {
  const path = normalizeObjectPath(pathValue);
  const { supabaseUrl, blogBucket } = getAppConfig();
  return {
    path,
    public_url: `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(blogBucket)}/${encodeObjectPath(path)}`,
  };
}

export async function listPosts(state: 'all' | 'published' | 'draft', limit: number) {
  const params = new URLSearchParams({
    select: BLOG_FIELDS,
    order: 'featured.desc,published_at.desc.nullslast,created_at.desc',
    limit: String(limit),
  });

  if (state === 'published') params.set('published', 'eq.true');
  if (state === 'draft') params.set('published', 'eq.false');

  const response = await supabaseFetch(`/rest/v1/blogs?${params.toString()}`);
  return (await response.json()) as BlogPost[];
}

export async function getPost(slug: string) {
  const params = new URLSearchParams({
    select: BLOG_FIELDS,
    slug: `eq.${slug}`,
    limit: '1',
  });
  const response = await supabaseFetch(`/rest/v1/blogs?${params.toString()}`);
  const rows = (await response.json()) as BlogPost[];

  if (!rows[0]) throw new Error(`Blog post not found: ${slug}`);
  return rows[0];
}

export async function createPost(input: CreateBlogPostInput) {
  const payload: Record<string, unknown> = {
    title: input.title.trim(),
    slug: input.slug,
    excerpt: input.excerpt.trim(),
    content: input.content,
    cover_image_url: input.cover_image_url ?? null,
    category: input.category?.trim() || null,
    tags: cleanTags(input.tags),
    featured: input.featured,
    published: input.published,
  };

  if (input.published_at) payload.published_at = normalizePublishedAt(input.published_at);

  const response = await supabaseFetch('/rest/v1/blogs?select=*', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });

  const rows = (await response.json()) as BlogPost[];
  if (!rows[0]) throw new Error('Supabase did not return the created blog post.');
  return rows[0];
}

export async function patchPost(slug: string, patch: Record<string, unknown>) {
  if (Object.keys(patch).length === 0) return getPost(slug);

  const params = new URLSearchParams({ slug: `eq.${slug}`, select: '*' });
  const response = await supabaseFetch(`/rest/v1/blogs?${params.toString()}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });

  const rows = (await response.json()) as BlogPost[];
  if (!rows[0]) throw new Error(`Blog post not found: ${slug}`);
  return rows[0];
}

export async function deletePost(slug: string) {
  await getPost(slug);
  const params = new URLSearchParams({ slug: `eq.${slug}` });

  await supabaseFetch(`/rest/v1/blogs?${params.toString()}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });

  return { deleted: true, slug };
}

export async function uploadImage(input: {
  path: string;
  content_type: ImageContentType;
  base64: string;
  upsert: boolean;
}) {
  const path = normalizeObjectPath(input.path);
  const encoded = input.base64.replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(encoded, 'base64');

  if (bytes.length === 0) throw new Error('Decoded image is empty.');
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the 3 MiB MCP upload limit.');
  }

  const { blogBucket } = getAppConfig();
  await supabaseFetch(`/storage/v1/object/${encodeURIComponent(blogBucket)}/${encodeObjectPath(path)}`, {
    method: 'POST',
    headers: {
      'Content-Type': input.content_type,
      'x-upsert': input.upsert ? 'true' : 'false',
      'Cache-Control': '3600',
    },
    body: new Uint8Array(bytes),
  });

  return {
    ...getPublicImageUrl(path),
    content_type: input.content_type,
    bytes: bytes.length,
  };
}

export async function deleteImage(pathValue: string) {
  const path = normalizeObjectPath(pathValue);
  const { blogBucket } = getAppConfig();
  const response = await supabaseFetch(`/storage/v1/object/${encodeURIComponent(blogBucket)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [path] }),
  });

  const result = await response.json().catch(() => []);
  return { deleted: true, path, result };
}
