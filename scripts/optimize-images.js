/*
 * One-time image optimization script.
 *
 * For every image directly under public/ (hero banners, car photos, favicon):
 *   - resize down to max width 1600px (never upscale)
 *   - re-encode and overwrite the original .jpg/.png in place (used as the <picture> fallback)
 *   - generate a WebP version at the same width, quality 82        -> name.webp
 *   - generate a smaller WebP version at max width 800 for mobile  -> name-800.webp
 *
 * For every image under public/images/ (the 140 traffic sign photos), same process
 * but capped at max width 600 / mobile width 300.
 *
 * Pristine, untouched copies of every original are saved to image-backups/ at the
 * repo root (NOT under public/, so they are never served by the static file server).
 * Re-running this script is safe/idempotent: it always re-derives outputs from the
 * backed-up original, never from a previously-resized file.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const BACKUP_DIR = path.join(ROOT, 'image-backups');

const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;
const PNG_QUALITY = 82;

const GROUPS = [
  {
    label: 'public/ (top-level)',
    dir: PUBLIC_DIR,
    recursive: false,
    primaryWidth: 1600,
    mobileWidth: 800,
  },
  {
    label: 'public/images/ (traffic signs)',
    dir: path.join(PUBLIC_DIR, 'images'),
    recursive: false,
    primaryWidth: 600,
    mobileWidth: 300,
  },
];

function isImage(fileName) {
  return /\.(jpe?g|png)$/i.test(fileName);
}

function listImages(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isImage(e.name))
    .map((e) => e.name)
    .sort();
}

function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(2)} ${units[i]}`;
}

async function backupOriginal(filePath, relPath) {
  const backupPath = path.join(BACKUP_DIR, relPath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }
  return backupPath;
}

async function encodeFallback(srcBuffer, ext, width) {
  const pipeline = sharp(srcBuffer).resize({ width, withoutEnlargement: true });
  if (ext === '.png') {
    return pipeline.png({ quality: PNG_QUALITY, compressionLevel: 9 }).toBuffer();
  }
  return pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}

async function encodeWebp(srcBuffer, width) {
  return sharp(srcBuffer)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 6 })
    .toBuffer();
}

async function processFile(filePath, relPath, group) {
  const beforeSize = fs.statSync(filePath).size;
  const backupPath = await backupOriginal(filePath, relPath);
  const srcBuffer = fs.readFileSync(backupPath);
  const meta = await sharp(srcBuffer).metadata();

  let ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  let base = path.basename(filePath, ext);
  let renamedFrom = null;

  // Some files on disk are mislabeled (e.g. a .png that is actually JPEG-encoded
  // photographic content). Encoding by the real detected format instead of the
  // extension avoids re-encoding a photo as PNG, which bloats it drastically.
  const trueExt = meta.format === 'jpeg' ? '.jpg' : meta.format === 'png' ? '.png' : ext;
  if (trueExt !== ext && !(trueExt === '.jpg' && ext === '.jpeg')) {
    renamedFrom = path.basename(filePath);
    fs.unlinkSync(filePath);
    ext = trueExt;
    filePath = path.join(dir, `${base}${ext}`);
  }

  const fallbackBuffer = await encodeFallback(srcBuffer, ext, group.primaryWidth);
  fs.writeFileSync(filePath, fallbackBuffer);

  const primaryWebp = await encodeWebp(srcBuffer, group.primaryWidth);
  const primaryWebpPath = path.join(dir, `${base}.webp`);
  fs.writeFileSync(primaryWebpPath, primaryWebp);

  const mobileWebp = await encodeWebp(srcBuffer, group.mobileWidth);
  const mobileWebpPath = path.join(dir, `${base}-${group.mobileWidth}.webp`);
  fs.writeFileSync(mobileWebpPath, mobileWebp);

  const fallbackMeta = await sharp(fallbackBuffer).metadata();

  return {
    relPath: renamedFrom ? path.join(path.dirname(relPath), path.basename(filePath)).replace(/\\/g, '/') : relPath,
    renamedFrom,
    beforeSize,
    fallbackSize: fallbackBuffer.length,
    primaryWebpSize: primaryWebp.length,
    mobileWebpSize: mobileWebp.length,
    originalWidth: meta.width,
    originalHeight: meta.height,
    width: fallbackMeta.width,
    height: fallbackMeta.height,
  };
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const results = [];
  let grandBefore = 0;
  let grandFallback = 0;
  let grandPrimaryWebp = 0;
  let grandMobileWebp = 0;

  for (const group of GROUPS) {
    const files = listImages(group.dir);
    console.log(`\n=== ${group.label} — ${files.length} image(s), max ${group.primaryWidth}px / ${group.mobileWidth}px mobile ===`);

    for (const fileName of files) {
      const filePath = path.join(group.dir, fileName);
      const relPath = path.relative(PUBLIC_DIR, filePath);
      const r = await processFile(filePath, relPath, group);
      results.push(r);
      grandBefore += r.beforeSize;
      grandFallback += r.fallbackSize;
      grandPrimaryWebp += r.primaryWebpSize;
      grandMobileWebp += r.mobileWebpSize;

      const renameNote = r.renamedFrom ? `  [RENAMED from ${r.renamedFrom} — mislabeled extension, update any references!]` : '';
      console.log(
        `  ${relPath.padEnd(28)} ${humanSize(r.beforeSize).padStart(10)} -> webp ${humanSize(r.primaryWebpSize).padStart(9)}` +
          ` | mobile webp ${humanSize(r.mobileWebpSize).padStart(9)} | fallback ${humanSize(r.fallbackSize).padStart(9)}` +
          `  (${r.originalWidth}x${r.originalHeight} -> ${r.width}x${r.height})${renameNote}`
      );
    }
  }

  console.log('\n=== TOTAL ===');
  console.log(`Original size (before)                         : ${humanSize(grandBefore)} (${grandBefore.toLocaleString()} bytes)`);
  console.log(`New WebP served to modern browsers (desktop)   : ${humanSize(grandPrimaryWebp)}  (${(100 - (grandPrimaryWebp / grandBefore) * 100).toFixed(1)}% smaller)`);
  console.log(`New WebP served to modern browsers (mobile)    : ${humanSize(grandMobileWebp)}  (${(100 - (grandMobileWebp / grandBefore) * 100).toFixed(1)}% smaller)`);
  console.log(`New fallback (.jpg/.png, non-WebP browsers)    : ${humanSize(grandFallback)}  (${(100 - (grandFallback / grandBefore) * 100).toFixed(1)}% smaller)`);
  console.log(`\nA page load only ever fetches ONE variant per image (via <picture>), so real-world`);
  console.log(`page weight drops from ~${humanSize(grandBefore)} to ~${humanSize(grandPrimaryWebp)} (desktop) / ~${humanSize(grandMobileWebp)} (mobile).`);
  console.log(`\nOn-disk footprint in public/ now (fallback + both webp sizes, all variants combined): ${humanSize(grandFallback + grandPrimaryWebp + grandMobileWebp)}`);
  console.log(`Pristine originals preserved in: ${path.relative(ROOT, BACKUP_DIR)}/ (not served by the static server)`);

  console.log('\n=== DIMENSIONS (for <picture>/<img> width & height attributes) ===');
  console.log(JSON.stringify(
    Object.fromEntries(results.map((r) => [r.relPath.replace(/\\/g, '/'), { width: r.width, height: r.height }])),
    null,
    2
  ));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
