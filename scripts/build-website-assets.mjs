#!/usr/bin/env node
// docs/61 — website/ images from the brand v2 sources in docs/logo/ (the
// same files app/scripts/build-brand-assets.mjs uses). Run from the repo
// root: `node scripts/build-website-assets.mjs`.
//
//   website/logo.png              icon + wordmark, 2x for a 36px-tall nav
//   website/icon.png              the rounded icon, 2x for 64px
//   website/favicon.png           same tight crop as the app's favicon
//   website/apple-touch-icon.png  180², opaque
//   website/og-image.png          1200×630 social preview
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logo = (f) => path.join(root, 'docs/logo', f);
const out = (f) => path.join(root, 'website', f);

const master = await sharp(logo('v2-icon.png')).resize(1024, 1024, { kernel: 'lanczos3' }).png().toBuffer();

async function rounded(size, source = master) {
  const r = Math.round(size * 0.22);
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}"/></svg>`);
  return sharp(source).resize(size, size, { kernel: 'lanczos3' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

await sharp(logo('v2-logo.png')).trim().resize({ height: 72, kernel: 'lanczos3' }).png().toFile(out('logo.png'));
await sharp(await rounded(128)).toFile(out('icon.png'));
const tight = await sharp(master).extract({ left: 184, top: 184, width: 656, height: 656 }).toBuffer();
await sharp(await rounded(64, tight)).toFile(out('favicon.png'));
await sharp(master).resize(180, 180, { kernel: 'lanczos3' }).png().toFile(out('apple-touch-icon.png'));

// Social preview: the logo centred on the site's light paper, with a soft
// wash of the icon's gradient behind it. No text: link previews already
// show the page title and description next to the image.
const W = 1200;
const H = 630;
const wash = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="78%" cy="18%" r="75%">
      <stop offset="0" stop-color="#6be9a9" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#6be9a9" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="h" cx="12%" cy="95%" r="60%">
      <stop offset="0" stop-color="#2fcba4" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#2fcba4" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#f5f8f6"/>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#h)"/>
</svg>`);
const ogLogo = await sharp(logo('v2-logo.png')).trim().resize({ width: 820, kernel: 'lanczos3' }).png().toBuffer();
await sharp(wash).composite([{ input: ogLogo, gravity: 'center' }]).png().toFile(out('og-image.png'));

console.log('website assets written');
