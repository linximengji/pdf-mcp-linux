import sharp from 'sharp';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const CACHE_DIR = path.join(os.tmpdir(), 'pdf-gen-img-cache');

async function ensureCache() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

export async function embedImages(
  markdownContent: string,
  imageSources: any[],
  options: any = {}
): Promise<any> {
  await ensureCache();
  const embedded: any[] = [];
  let totalKb = 0;
  let processedMarkdown = markdownContent;

  for (const src of imageSources) {
    try {
      const result = await processImage(src, options);
      const html = buildImageHTML(result, src);
      processedMarkdown = processedMarkdown.replace(src.placeholder, html);
      embedded.push(result);
      totalKb += result.sizeKb;
    } catch (e: any) {
      processedMarkdown = processedMarkdown.replace(
        src.placeholder,
        `[Image Error: ${e.message}]`
      );
    }
  }

  return {
    success: true,
    processed_markdown: processedMarkdown,
    embedded_images: embedded.length,
    total_size_kb: Math.round(totalKb)
  };
}

async function processImage(src: any, options: any): Promise<any> {
  let imagePath: string;

  if (src.source.startsWith('data:')) {
    imagePath = await saveBase64(src.source);
  } else if (src.source.startsWith('http')) {
    imagePath = await downloadImage(src.source);
  } else {
    imagePath = src.source;
    await fs.access(imagePath);
  }

  const meta = await sharp(imagePath).metadata();
  const shouldOptimize = options.auto_optimize !== false || src.width || src.height || options.quality;
  let finalPath = imagePath;

  if (shouldOptimize) {
    const optimized = await optimizeImage(imagePath, {
      width: src.width, height: src.height,
      quality: options.quality || 85, format: options.format || 'auto'
    });
    const origSize = (await fs.stat(imagePath)).size;
    const optSize = (await fs.stat(optimized)).size;
    if (optSize < origSize) finalPath = optimized;
  }

  const stats = await fs.stat(finalPath);
  return {
    path: finalPath,
    width: meta.width,
    height: meta.height,
    sizeKb: stats.size / 1024
  };
}

async function downloadImage(url: string): Promise<string> {
  new URL(url);
  const hash = crypto.createHash('md5').update(url).digest('hex');
  const ext = path.extname(new URL(url).pathname) || '.jpg';
  const cached = path.join(CACHE_DIR, `${hash}${ext}`);
  try { await fs.access(cached); return cached; } catch {}

  const resp = await axios({
    method: 'GET', url, responseType: 'stream',
    timeout: 30000, maxContentLength: 50 * 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0 (PDFGenerator/2.0)' }
  });
  const buf = await streamToBuffer(resp.data);
  await fs.writeFile(cached, buf);
  return cached;
}

async function saveBase64(dataUrl: string): Promise<string> {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid base64 data URL');
  const hash = crypto.createHash('md5').update(m[2]).digest('hex');
  const ext = mimeExt(m[1]);
  const cached = path.join(CACHE_DIR, `b64_${hash}${ext}`);
  try { await fs.access(cached); return cached; } catch {}
  await fs.writeFile(cached, Buffer.from(m[2], 'base64'));
  return cached;
}

async function optimizeImage(imagePath: string, opts: any): Promise<string> {
  const hash = crypto.createHash('md5').update(imagePath + JSON.stringify(opts)).digest('hex');
  const ext = path.extname(imagePath);
  const out = path.join(CACHE_DIR, `opt_${hash}${ext}`);
  try { await fs.access(out); return out; } catch {}

  let s = sharp(imagePath);
  if (opts.width || opts.height) {
    s = s.resize(opts.width, opts.height, { fit: 'inside', withoutEnlargement: true });
  }
  let fmt = opts.format === 'auto' ? ((await s.metadata()).format === 'png' ? 'png' : 'jpeg') : opts.format;
  if (fmt === 'jpeg' || fmt === 'jpg') s = s.jpeg({ quality: opts.quality, progressive: true });
  else if (fmt === 'png') s = s.png({ compressionLevel: 9, adaptiveFiltering: true });
  else if (fmt === 'webp') s = s.webp({ quality: opts.quality });
  await s.toFile(out);
  return out;
}

function buildImageHTML(result: any, src: any): string {
  const align = src.alignment || 'left';
  const alt = src.alt || 'Image';
  const style = `max-width:100%;max-height:70vh;height:auto;object-fit:contain;` +
    (align === 'center' ? 'display:block;margin:1.5em auto;' : 'display:block;margin:1.5em 0;');
  const imgTag = `<img src="file://${result.path}" alt="${alt}" style="${style}" />`;
  return src.caption
    ? `<figure style="text-align:${align};margin:1.5em 0">${imgTag}<figcaption style="margin-top:0.5em;font-style:italic;color:#666">${src.caption}</figcaption></figure>`
    : imgTag;
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function mimeExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/svg+xml': '.svg'
  };
  return map[mime] || '.jpg';
}
