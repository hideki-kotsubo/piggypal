#!/usr/bin/env node
// docs/60 — regenerates every app icon/splash input from the brand v2 icon
// (docs/logo/v2-icon.png, a full-bleed square). Run from app/:
//
//   node scripts/build-brand-assets.mjs
//   npx capacitor-assets generate --ios --android   (reads resources/)
//
// Outputs:
//   resources/icon-only.png         1024² master (iOS icon)
//   resources/icon-background.png   Android adaptive background, see below
//   resources/icon-foreground.png   Android adaptive foreground (empty)
//   resources/splash(-dark).png     2732² rounded icon on the app background
//   public/icons/icon-*.webp        PWA manifest icons
//   public/apple-touch-icon.png     180², opaque (iOS rounds it)
//   public/favicon.png              64², rounded corners
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(appRoot, '../docs/logo/v2-icon.png');
const out = (p) => path.join(appRoot, p);

// The app's own background colours (src/styles/tokens.css --bg), so the
// splash matches the first screen it hands over to.
const BG_LIGHT = '#eef0ea';
const BG_DARK = '#141713';

// The source is 637², so this is an upscale (flat shapes and a soft
// gradient survive lanczos well). Swap in a ≥1024² export when one exists.
const master = await sharp(SOURCE).resize(1024, 1024, { kernel: 'lanczos3' }).png().toBuffer();

mkdirSync(out('resources'), { recursive: true });
mkdirSync(out('public/icons'), { recursive: true });

await sharp(master).toFile(out('resources/icon-only.png'));

// Android adaptive icons: Capacitor's ic_launcher.xml insets both layers by
// 16.7%, so each layer image fills exactly the visible 72-unit window and
// the launcher's mask (circle, squircle...) cuts into that. The full icon
// therefore works as the background as-is; the waves sit inside the middle
// 60%, clear of even a circle mask. The foreground is left empty: the waves
// stay on the gradient they were drawn on (no clean way to cut them out of
// a raster).
await sharp(master).toFile(out('resources/icon-background.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .png()
  .toFile(out('resources/icon-foreground.png'));

// Rounded-corner copy (iOS-like 22% radius) for places that don't mask the
// icon themselves: the splash and the favicon.
async function rounded(size, source = master) {
  const r = Math.round(size * 0.22);
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`,
  );
  return sharp(source)
    .resize(size, size, { kernel: 'lanczos3' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

const splashIcon = await rounded(600);
for (const [file, background] of [
  ['resources/splash.png', BG_LIGHT],
  ['resources/splash-dark.png', BG_DARK],
]) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background } })
    .composite([{ input: splashIcon, gravity: 'center' }])
    .png()
    .toFile(out(file));
}

for (const size of [48, 72, 96, 128, 192, 256, 512]) {
  await sharp(master).resize(size, size, { kernel: 'lanczos3' }).webp({ quality: 90 }).toFile(out(`public/icons/icon-${size}.webp`));
}
await sharp(master).resize(180, 180, { kernel: 'lanczos3' }).png().toFile(out('public/apple-touch-icon.png'));
// At 16-32px the full icon's padding leaves the waves a few pixels wide, so
// the favicon crops in to the middle 64%, where the waves are.
const tight = await sharp(master).extract({ left: 184, top: 184, width: 656, height: 656 }).toBuffer();
await sharp(await rounded(64, tight)).toFile(out('public/favicon.png'));

console.log('brand assets written');
