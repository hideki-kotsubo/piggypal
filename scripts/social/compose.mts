// docs/74 — renders marketing/posts/*.md into branded images, one set per
// language, plus the profile pictures and banners for every network.
// Templates are HTML in the website's brand v2 palette and fonts
// (website/site.css), screenshotted by Playwright at the exact pixel size.
//
//   npm run social:compose                     every post, every language it has
//   npm run social:compose -- 2026-10-21-dollars   one post (file name, no .md)
//   npm run social:compose -- --profile        avatars + banners only
//
// Writes marketing/out/posts/<id>/<lang>-{feed,story}.png and
// <lang>-captions.txt (the text for each platform, for posting by hand,
// D306), and marketing/out/profile/*.png (git-ignored).
// Run `npm run social:screenshots` first: feature/update posts embed them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import type { Language } from './languages.mts';
import { captionFor, loadPosts, type Platform, type Post, type PostCopy } from './posts.mts';

// One file to copy from when posting by hand: a block per group of
// platforms that share a text, then the image's alt text.
const GROUPS: [string, Platform[]][] = [
  ['Facebook, LinkedIn', ['facebook', 'linkedin']],
  ['X, Bluesky', ['x', 'bluesky']],
  ['Instagram, Threads, TikTok', ['instagram', 'threads', 'tiktok']],
];
function captionsFile(post: Post, lang: Language, c: PostCopy): string {
  const blocks = GROUPS.filter(([, ps]) => ps.some((p) => post.platforms.includes(p)))
    .map(([name, ps]) => [name, captionFor(c, lang, ps[0])])
    .filter(([, text]) => text);
  if (c.alt) blocks.push(['Alt text (image description)', c.alt]);
  return blocks.map(([name, text]) => `===== ${name} =====\n\n${text}\n`).join('\n');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'marketing/out');

const dataUri = (file: string) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const LOGO = dataUri(path.join(root, 'docs/logo/v2-logo.png'));
const ICON = dataUri(path.join(root, 'docs/logo/v2-icon.png'));

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The website's palette and type, light theme only: posts are seen in
// every app's own theme, and the light one reads best in a feed.
const BASE_CSS = `
  :root {
    --paper: #f5f8f6; --surface: #ffffff; --ink: #0f1a17; --ink-soft: #4a5c57;
    --line: #dde7e3; --flow: #2fcba4; --flow-ink: #0a6f59; --flow-deep: #125251;
    --flow-soft: #ddf7ee; --on-gradient: #06291f;
    --gradient: linear-gradient(135deg, #2fcba4 0%, #6be9a9 100%);
    --display: 'Space Grotesk', -apple-system, sans-serif;
    --body: 'Inter', -apple-system, 'Segoe UI', sans-serif;
    --mono: 'JetBrains Mono', ui-monospace, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    width: var(--w); height: var(--h); overflow: hidden; position: relative;
    background: var(--paper); color: var(--ink); font-family: var(--body);
  }
  body::before, body::after { content: ""; position: absolute; z-index: 0; pointer-events: none; border-radius: 50%; }
  body::before { width: 1300px; height: 1300px; right: -520px; top: -640px;
    background: radial-gradient(closest-side, rgba(107, 233, 169, 0.42), transparent); }
  body::after { width: 1000px; height: 1000px; left: -480px; bottom: -520px;
    background: radial-gradient(closest-side, rgba(47, 203, 164, 0.28), transparent); }
  .page { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; padding: var(--pad); }
  .logo { height: 64px; width: auto; display: block; align-self: flex-start; }
  h1 { font-family: var(--display); font-weight: 700; letter-spacing: -0.03em; line-height: 1.02;
       margin: 0; text-wrap: balance; font-size: var(--h1); }
  .sub { font-size: var(--subsize); color: var(--ink-soft); line-height: 1.3; margin: 22px 0 0; text-wrap: balance; }
  .phone { border: 12px solid var(--ink); border-radius: 64px; overflow: hidden; background: var(--surface);
           box-shadow: 0 2px 4px rgba(15,26,23,.08), 0 40px 80px rgba(15,26,23,.18); }
  .phone img { display: block; width: 100%; height: 100%; object-fit: cover; }
  ul { list-style: none; padding: 0; margin: 34px 0 0; }
  li { font-size: var(--lisize); line-height: 1.3; padding-left: 52px; position: relative; margin: 0 0 20px; }
  li::before { content: ""; position: absolute; left: 0; top: .32em; width: 28px; height: 28px; border-radius: 50%; background: var(--gradient); }
  .foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; padding-top: 28px; }
  .foot .logo { height: 54px; }
  .tag { font-family: var(--mono); font-size: 26px; letter-spacing: .04em; color: var(--flow-ink); font-weight: 600; text-transform: uppercase; }
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=block" rel="stylesheet">`;

function page(lang: Language, w: number, h: number, vars: string, body: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">${FONTS}
<style>${BASE_CSS} body { --w: ${w}px; --h: ${h}px; ${vars} }</style></head>
<body><div class="page">${body}</div></body></html>`;
}

type Format = 'feed' | 'story';
const SIZE: Record<Format, [number, number]> = { feed: [1080, 1350], story: [1080, 1920] };

function screenshotFile(post: Post, lang: Language): string {
  const file = path.join(OUT, 'screenshots', lang, `${post.screen}.png`);
  if (!existsSync(file)) throw new Error(`${post.id}: no ${path.relative(root, file)} — run npm run social:screenshots`);
  return file;
}

function postHtml(post: Post, lang: Language, c: PostCopy, format: Format): string {
  const [w, h] = SIZE[format];
  const story = format === 'story';
  const vars = story
    ? '--pad: 150px 90px 120px; --h1: 104px; --subsize: 44px; --lisize: 42px;'
    : '--pad: 80px 84px 64px; --h1: 92px; --subsize: 40px; --lisize: 38px;';
  const head = `<h1>${escape(c.headline)}</h1>${c.sub ? `<p class="sub">${escape(c.sub)}</p>` : ''}`;
  const foot = `<div class="foot"><img class="logo" src="${LOGO}" alt=""></div>`;

  if (post.template === 'tip') {
    const card = `<div style="margin-top:auto;margin-bottom:auto">
      <div style="width:120px;height:14px;border-radius:7px;background:var(--gradient);margin-bottom:56px"></div>
      <h1 style="font-size:${story ? 128 : 112}px">${escape(c.headline)}</h1>
      ${c.sub ? `<p class="sub" style="font-size:${story ? 50 : 44}px;margin-top:40px">${escape(c.sub)}</p>` : ''}
      ${c.bullets.length ? `<ul>${c.bullets.map((b) => `<li>${escape(b)}</li>`).join('')}</ul>` : ''}
    </div>`;
    return page(lang, w, h, vars, card + foot);
  }

  // feature / update: copy on top, a window onto the phone screen below.
  // The window shows the top or the bottom of the screen (crop:). A top
  // crop runs off the feed's bottom edge, so it reads as "there's more";
  // a bottom crop ends on the screen's own bottom edge (the Save button).
  const bullets = post.template === 'update' && c.bullets.length
    ? `<ul>${c.bullets.slice(0, story ? 5 : 3).map((b) => `<li>${escape(b)}</li>`).join('')}</ul>` : '';
  const phoneW = story ? 640 : 600;
  const phone = `<div style="flex:1;min-height:0;position:relative;margin-top:${story ? 72 : 56}px">
    <div class="phone" style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:${phoneW}px;
      height:${story || post.crop === 'bottom' ? '100%' : 'calc(100% + 90px)'};max-height:${Math.round(phoneW * 2.164)}px">
      <img src="${dataUri(screenshotFile(post, lang))}" alt="" style="object-position:${post.crop}">
    </div></div>`;
  const logo = `<img class="logo" src="${LOGO}" alt="" style="margin-bottom:${story ? 72 : 52}px">`;
  const pad = story ? '' : post.crop === 'bottom' ? '--pad: 72px 84px 64px;' : '--pad: 72px 84px 0;';
  return page(lang, w, h, vars + pad, logo + head + bullets + phone);
}

async function render(browser: Browser, html: string, w: number, h: number, file: string) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.setContent(html, { waitUntil: 'networkidle' });
  await pg.evaluate(() => document.fonts.ready);
  await pg.screenshot({ path: file });
  await ctx.close();
}

// ---- profile pictures and banners ----
// One set for every network, English: the profiles themselves are the
// shared main account's (D273). Banner text stays inside each network's
// safe area, which is the centre for all of them.
const TAGLINE = "Type it or say it. It's on the tab.";
const BANNERS: { name: string; w: number; h: number; safeW: number; safeH: number }[] = [
  { name: 'facebook-cover', w: 1640, h: 624, safeW: 1240, safeH: 520 },
  { name: 'youtube-banner', w: 2560, h: 1440, safeW: 1546, safeH: 423 },
  { name: 'linkedin-cover', w: 1128, h: 191, safeW: 900, safeH: 160 },
  { name: 'x-header', w: 1500, h: 500, safeW: 1100, safeH: 330 },
];

function avatarHtml(): string {
  // Networks crop to a circle: the icon's own rounded square sits well
  // inside it, on the brand's paper with the gradient wash.
  return page('en', 1080, 1080, '--pad: 0;',
    `<div style="height:100%;display:grid;place-items:center"><img src="${ICON}" style="width:700px;height:700px;border-radius:154px" alt=""></div>`);
}

function bannerHtml(b: (typeof BANNERS)[number]): string {
  const scale = b.safeH / 330;
  return page('en', b.w, b.h, '--pad: 0;',
    `<div style="height:100%;display:grid;place-items:center">
      <div style="width:${b.safeW}px;height:${b.safeH}px;display:flex;align-items:center;justify-content:center;gap:${Math.round(56 * scale)}px">
        <img src="${LOGO}" style="height:${Math.round(110 * scale)}px" alt="">
        <span style="width:${Math.max(2, Math.round(3 * scale))}px;align-self:stretch;margin:${Math.round(90 * scale)}px 0;background:var(--line)"></span>
        <span style="font-family:var(--display);font-weight:600;letter-spacing:-.02em;font-size:${Math.round(58 * scale)}px;max-width:${Math.round(b.safeW * 0.48)}px;line-height:1.1">${escape(TAGLINE)}</span>
      </div></div>`);
}

const args = process.argv.slice(2);
const browser = await chromium.launch();
try {
  if (args.includes('--profile')) {
    const dir = path.join(OUT, 'profile');
    mkdirSync(dir, { recursive: true });
    await render(browser, avatarHtml(), 1080, 1080, path.join(dir, 'avatar.png'));
    for (const b of BANNERS) await render(browser, bannerHtml(b), b.w, b.h, path.join(dir, `${b.name}.png`));
    console.log(`profile: ${path.relative(root, dir)}`);
  } else {
    const wanted = args.filter((a) => !a.startsWith('--'));
    const posts = loadPosts(path.join(root, 'marketing/posts')).filter((p) => !wanted.length || wanted.includes(p.id));
    if (wanted.length && !posts.length) throw new Error(`No post named ${wanted.join(', ')}`);
    for (const post of posts) {
      const dir = path.join(OUT, 'posts', post.id);
      mkdirSync(dir, { recursive: true });
      for (const [lang, c] of Object.entries(post.copy) as [Language, PostCopy][]) {
        for (const format of ['feed', 'story'] as const) {
          const [w, h] = SIZE[format];
          await render(browser, postHtml(post, lang, c, format), w, h, path.join(dir, `${lang}-${format}.png`));
        }
        writeFileSync(path.join(dir, `${lang}-captions.txt`), captionsFile(post, lang, c));
      }
      console.log(`${post.id}: ${Object.keys(post.copy).join(', ')}`);
    }
  }
} finally {
  await browser.close();
}
