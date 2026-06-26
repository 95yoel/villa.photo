import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Photo } from '../../src/app/models/photo.model';

const PROJECT_ROOT = process.cwd();
const PHOTOS_JSON_PATH = path.join(
  PROJECT_ROOT,
  'tools',
  'gallery',
  'output',
  'photos.json'
);
const SITEMAP_PATH = path.join(PROJECT_ROOT, 'public', 'sitemap.xml');
const SITE_BASE_URL =
  process.env['SITE_BASE_URL']?.trim().replace(/\/+$/, '') ?? 'https://villa.photos';

const STATIC_ROUTES = ['/', '/costa', '/montana', '/nocturnas', '/ciudad'];

async function main(): Promise<void> {
  const serializedPhotos = await readFile(PHOTOS_JSON_PATH, 'utf8');
  const photos = JSON.parse(stripBom(serializedPhotos)) as Partial<Photo>[];
  const photoRoutes = photos
    .map((photo) => photo.slug)
    .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
    .map((slug) => `/foto/${encodeURIComponent(slug)}`);
  const routes = [...STATIC_ROUTES, ...photoRoutes];
  const sitemap = createSitemap(routes);

  await writeFile(SITEMAP_PATH, sitemap, 'utf8');

  console.log(`[sitemap] Wrote ${SITEMAP_PATH}`);
  console.log(`[sitemap] Added ${routes.length} routes`);
}

function createSitemap(routes: string[]): string {
  const urls = routes
    .map((route) => {
      const priority = route === '/' ? '1.0' : route.startsWith('/foto/') ? '0.6' : '0.8';

      return [
        '  <url>',
        `    <loc>${escapeXml(`${SITE_BASE_URL}${route}`)}</loc>`,
        '    <changefreq>weekly</changefreq>',
        `    <priority>${priority}</priority>`,
        '  </url>'
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    ''
  ].join('\n');
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sitemap] Build failed: ${message}`);
  process.exitCode = 1;
});
