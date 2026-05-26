import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import { encode } from 'blurhash';
import dotenv from 'dotenv';
import fg from 'fast-glob';
import sharp from 'sharp';
import type { Photo, PhotoCategory } from '../../src/app/models/photo.model';

dotenv.config();

const PROJECT_ROOT = process.cwd();
const INPUT_DIR = path.join(PROJECT_ROOT, 'tools', 'gallery', 'input');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'tools', 'gallery', 'output');
const OUTPUT_JSON_PATH = path.join(OUTPUT_DIR, 'photos.json');

const MAX_WIDTH = 2400;
const WEBP_QUALITY = 86;
const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const JSON_CACHE_CONTROL = 'public, max-age=60, must-revalidate';
const BLURHASH_SIZE = 32;
const BLURHASH_COMPONENT_X = 4;
const BLURHASH_COMPONENT_Y = 3;
const VALID_CATEGORIES: PhotoCategory[] = ['costa', 'montana', 'nocturnas', 'ciudad'];
const TRAILING_IMAGE_EXTENSION_PATTERN = /\.(?:jpe?g|png|webp|tiff?)$/i;

sharp.cache(false);
sharp.concurrency(1);

type EnvConfig = {
  awsProfile: string;
  awsRegion: string;
  s3Bucket: string;
  cdnBaseUrl: string;
};

type ParsedFilename = {
  slug: string;
  title: string;
  category: PhotoCategory;
  location: string;
};

type GalleryPhoto = Photo & {
  sourceSizeBytes: number;
};

async function main(): Promise<void> {
  const env = readEnv();

  console.log('[gallery] Starting gallery build');
  console.log(`[gallery] Reading from ${INPUT_DIR}`);
  console.log('[gallery] Sharp cache disabled, concurrency set to 1');

  await mkdir(OUTPUT_DIR, { recursive: true });

  const inputFiles = await fg(['*.jpg', '*.jpeg', '*.png', '*.webp', '*.tif', '*.tiff'], {
    cwd: INPUT_DIR,
    absolute: true,
    caseSensitiveMatch: false
  });

  if (inputFiles.length === 0) {
    throw new Error(`No images found in ${INPUT_DIR}`);
  }

  const s3Client = new S3Client({
    region: env.awsRegion,
    credentials: fromIni({ profile: env.awsProfile })
  });

  const existingPhotos = await readExistingPhotosManifest(s3Client, env.s3Bucket);
  const existingPhotosBySlug = new Map(
    existingPhotos.map((photo) => [photo.slug, photo])
  );
  const photos: GalleryPhoto[] = [];

  for (const inputFile of inputFiles.sort()) {
    const fileName = path.basename(inputFile);
    const parsedFile = parseFilename(fileName);
    const sourceSizeBytes = (await stat(inputFile)).size;
    const existingPhoto = existingPhotosBySlug.get(parsedFile.slug);
    const s3Key = `photos/${parsedFile.slug}.webp`;

    if (existingPhoto?.sourceSizeBytes === sourceSizeBytes) {
      console.log(`[gallery] Skipping ${fileName}; source file is unchanged`);
      photos.push(createPhotoFromExisting(parsedFile, existingPhoto, env, s3Key));
      continue;
    }

    const photo = await processImage(
      inputFile,
      parsedFile,
      sourceSizeBytes,
      env,
      s3Client
    );
    photos.push(photo);
  }

  const serializedPhotos = `${JSON.stringify(photos, null, 2)}\n`;

  await writeFile(OUTPUT_JSON_PATH, serializedPhotos, 'utf8');

  await uploadBuffer(
    s3Client,
    env.s3Bucket,
    'photos.json',
    Buffer.from(serializedPhotos, 'utf8'),
    'application/json; charset=utf-8',
    JSON_CACHE_CONTROL
  );

  console.log(`[gallery] Wrote ${OUTPUT_JSON_PATH}`);
  console.log(`[gallery] Uploaded s3://${env.s3Bucket}/photos.json`);
  console.log('[gallery] Done');
}

function readEnv(): EnvConfig {
  const awsProfile = process.env['AWS_PROFILE']?.trim();
  const awsRegion = process.env['AWS_REGION']?.trim();
  const s3Bucket = process.env['S3_BUCKET']?.trim();
  const cdnBaseUrl = process.env['CDN_BASE_URL']?.trim().replace(/\/+$/, '');

  const missing = [
    !awsProfile ? 'AWS_PROFILE' : null,
    !awsRegion ? 'AWS_REGION' : null,
    !s3Bucket ? 'S3_BUCKET' : null,
    !cdnBaseUrl ? 'CDN_BASE_URL' : null
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    awsProfile: awsProfile!,
    awsRegion: awsRegion!,
    s3Bucket: s3Bucket!,
    cdnBaseUrl: cdnBaseUrl!
  };
}

async function readExistingPhotosManifest(
  s3Client: S3Client,
  bucket: string
): Promise<GalleryPhoto[]> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: 'photos.json'
      })
    );
    const body = response.Body as
      | { transformToString(): Promise<string> }
      | undefined;

    if (!body) {
      return [];
    }

    const serializedPhotos = await body.transformToString();
    const photos = JSON.parse(serializedPhotos) as Partial<GalleryPhoto>[];

    return photos.filter(isReusableGalleryPhoto);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.log(`[gallery] Could not reuse existing photos.json: ${message}`);
    console.log('[gallery] Processing all input images');

    return [];
  }
}

function isReusableGalleryPhoto(photo: Partial<GalleryPhoto>): photo is GalleryPhoto {
  return (
    typeof photo.id === 'string' &&
    typeof photo.slug === 'string' &&
    typeof photo.title === 'string' &&
    typeof photo.category === 'string' &&
    typeof photo.location === 'string' &&
    typeof photo.src === 'string' &&
    typeof photo.thumb === 'string' &&
    typeof photo.alt === 'string' &&
    typeof photo.width === 'number' &&
    typeof photo.height === 'number' &&
    typeof photo.blurhash === 'string' &&
    typeof photo.dominantColor === 'string' &&
    typeof photo.sourceSizeBytes === 'number'
  );
}

async function processImage(
  inputFile: string,
  parsedFile: ParsedFilename,
  sourceSizeBytes: number,
  env: EnvConfig,
  s3Client: S3Client
): Promise<GalleryPhoto> {
  const fileName = path.basename(inputFile);
  const outputFileName = `${parsedFile.slug}.webp`;
  const outputFilePath = path.join(OUTPUT_DIR, outputFileName);
  const s3Key = `photos/${outputFileName}`;

  console.log(`[gallery] Processing ${fileName}`);

  const { data: processedBuffer, info } = await sharp(inputFile)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });

  await writeFile(outputFilePath, processedBuffer);

  const width = info.width ?? 0;
  const height = info.height ?? 0;

  if (!width || !height) {
    throw new Error(`Could not read dimensions for ${fileName}`);
  }

  const blurhash = await createBlurhash(processedBuffer);
  const dominantColor = await createDominantColor(processedBuffer);

  await uploadBuffer(
    s3Client,
    env.s3Bucket,
    s3Key,
    processedBuffer,
    'image/webp',
    IMAGE_CACHE_CONTROL
  );

  console.log(`[gallery] Uploaded s3://${env.s3Bucket}/${s3Key}`);

  return {
    id: parsedFile.slug,
    slug: parsedFile.slug,
    title: parsedFile.title,
    category: parsedFile.category,
    location: parsedFile.location,
    src: `${env.cdnBaseUrl}/${s3Key}`,
    thumb: `${env.cdnBaseUrl}/${s3Key}`,
    alt: `${parsedFile.title} en ${parsedFile.location}`,
    width,
    height,
    blurhash,
    dominantColor,
    sourceSizeBytes
  };
}

function createPhotoFromExisting(
  parsedFile: ParsedFilename,
  existingPhoto: GalleryPhoto,
  env: EnvConfig,
  s3Key: string
): GalleryPhoto {
  return {
    ...existingPhoto,
    id: parsedFile.slug,
    slug: parsedFile.slug,
    title: parsedFile.title,
    category: parsedFile.category,
    location: parsedFile.location,
    src: `${env.cdnBaseUrl}/${s3Key}`,
    thumb: `${env.cdnBaseUrl}/${s3Key}`,
    alt: `${parsedFile.title} en ${parsedFile.location}`
  };
}

function parseFilename(fileName: string): ParsedFilename {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const [titleSegment, categorySegment, locationSegment, ...rest] = baseName.split('_');

  if (!titleSegment || !categorySegment || !locationSegment || rest.length > 0) {
    throw new Error(
      `Invalid filename "${fileName}". Expected format titulo-con-guiones_categoria_location.jpg`
    );
  }

  const category = categorySegment.toLowerCase() as PhotoCategory;

  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(
      `Invalid category "${categorySegment}" in "${fileName}". Valid categories: ${VALID_CATEGORIES.join(', ')}`
    );
  }

  const cleanTitleSegment = stripTrailingImageExtension(titleSegment);
  const cleanLocationSegment = stripTrailingImageExtension(locationSegment);
  const slug = normalizeSlug(cleanTitleSegment);

  return {
    slug,
    title: toDisplayText(cleanTitleSegment),
    category,
    location: toDisplayText(cleanLocationSegment)
  };
}

function stripTrailingImageExtension(value: string): string {
  return value.replace(TRAILING_IMAGE_EXTENSION_PATTERN, '');
}

function normalizeSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

function toDisplayText(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

async function createBlurhash(imageBuffer: Buffer): Promise<string> {
  const { data, info } = await sharp(imageBuffer)
    .resize(BLURHASH_SIZE, BLURHASH_SIZE, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return encode(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
    BLURHASH_COMPONENT_X,
    BLURHASH_COMPONENT_Y
  );
}

async function createDominantColor(imageBuffer: Buffer): Promise<string> {
  const stats = await sharp(imageBuffer)
    .resize(64, 64, { fit: 'inside' })
    .stats();
  const dominant = stats.dominant;

  return `#${[dominant.r, dominant.g, dominant.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

async function uploadBuffer(
  s3Client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
  cacheControl?: string
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl
    })
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[gallery] Build failed: ${message}`);
  process.exitCode = 1;
});
