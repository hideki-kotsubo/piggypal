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
// D306), and marketing/out/profile/*.png (git-ignored). A carousel also
// gets <lang>-slide-NN.png (the cover, its slides and an end slide) and
// <lang>-carousel.pdf, the same slides as pages for LinkedIn, which shows
// carousels only as documents; its feed image is the cover.
// Run `npm run social:screenshots` first: feature/update posts embed them.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import type { Language } from './languages.mts';
import { dataUri, escape, ICON, LOGO, page } from './brand.mts';
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
  if (post.template === 'carousel') {
    const n = c.slides.length + 2;
    blocks.push(['Images', [
      `Facebook, Instagram, Threads: ${lang}-slide-01.png to ${lang}-slide-${String(n).padStart(2, '0')}.png, in order.`,
      `LinkedIn: ${lang}-carousel.pdf, as a document (Add a document), titled with the headline.`,
      `X, Bluesky: the first four slides (both take at most four images).`,
      `TikTok: all slides as a photo post, with a sound.`,
    ].join('\n')]);
  }
  return blocks.map(([name, text]) => `===== ${name} =====\n\n${text}\n`).join('\n');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'marketing/out');

type Format = 'feed' | 'story';
const SIZE: Record<Format, [number, number]> = { feed: [1080, 1350], story: [1080, 1920] };

function screenshotFile(post: Post, lang: Language, screen = post.screen): string {
  const file = path.join(OUT, 'screenshots', lang, `${screen}.png`);
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

  if (post.template === 'tip' || post.template === 'carousel') {
    const card = `<div style="margin-top:auto;margin-bottom:auto">
      <div style="width:120px;height:14px;border-radius:7px;background:var(--gradient);margin-bottom:56px"></div>
      <h1 style="font-size:${story ? 128 : 112}px">${escape(c.headline)}</h1>
      ${c.sub ? `<p class="sub" style="font-size:${story ? 50 : 44}px;margin-top:40px">${escape(c.sub)}</p>` : ''}
      ${c.bullets.length ? `<ul>${c.bullets.map((b) => `<li>${escape(b)}</li>`).join('')}</ul>` : ''}
    </div>`;
    const swipe = post.template === 'carousel' && !story ? `<span class="tag">${escape(SWIPE[lang])}</span>` : '';
    return page(lang, w, h, vars, card + foot.replace('</div>', `${swipe}</div>`));
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

// ---- carousels ----
// Slides are 1080×1350 like the feed: the cover is the feed image, then one
// slide per step (number, title, text, and a screen when the step has
// one), then an end slide with the link.
const SWIPE: Record<Language, string> = { en: 'Swipe →', 'pt-BR': 'Arraste →', es: 'Desliza →', fr: 'Glissez →' };
const END: Record<Language, [string, string]> = {
  en: ['Type it or say it.', 'Free · No sign-up · Works offline'],
  'pt-BR': ['Digite ou fale.', 'Grátis · Sem cadastro · Funciona offline'],
  es: ['Escríbelo o dilo.', 'Gratis · Sin registro · Funciona sin conexión'],
  fr: ['Écrivez-le ou dites-le.', 'Gratuit · Sans inscription · Fonctionne hors ligne'],
};

function slideHtml(post: Post, lang: Language, c: PostCopy, i: number): string {
  const slide = c.slides[i];
  const n = `<div class="tag" style="margin-bottom:28px">${i + 1} / ${c.slides.length}</div>`;
  const head = `${n}<h1 style="font-size:${slide.screen ? 76 : 96}px">${escape(slide.title)}</h1>
    ${slide.text ? `<p class="sub" style="font-size:${slide.screen ? 38 : 46}px;margin-top:${slide.screen ? 22 : 36}px">${escape(slide.text)}</p>` : ''}`;
  if (!slide.screen) {
    return page(lang, 1080, 1350, '--pad: 80px 84px 64px; --h1: 96px;',
      `<div style="margin-top:auto;margin-bottom:auto">
        <div style="width:120px;height:14px;border-radius:7px;background:var(--gradient);margin-bottom:56px"></div>${head}</div>
      <div class="foot"><img class="logo" src="${LOGO}" alt=""></div>`);
  }
  // A window onto the top of the screen, running off the bottom edge.
  return page(lang, 1080, 1350, '--pad: 72px 84px 0; --h1: 76px; --subsize: 38px;',
    `${head}<div style="flex:1;min-height:0;position:relative;margin-top:44px">
      <div class="phone" style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:560px;height:calc(100% + 90px)">
        <img src="${dataUri(screenshotFile(post, lang, slide.screen))}" alt="" style="object-position:top">
      </div></div>`);
}

function endSlideHtml(lang: Language): string {
  const [line, facts] = END[lang];
  return page(lang, 1080, 1350, '--pad: 0;',
    `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px;text-align:center">
      <img src="${LOGO}" style="height:120px;width:auto" alt="">
      <div style="font-family:var(--display);font-weight:700;letter-spacing:-.03em;font-size:84px">${escape(line)}</div>
      <div style="font-size:40px;color:var(--ink-soft)">${escape(facts)}</div>
      <div style="font-family:var(--display);font-weight:600;font-size:56px;padding:22px 48px;border-radius:999px;background:var(--gradient);color:var(--on-gradient)">myflowtab.com</div>
    </div>`);
}

// All slides as one PDF, a page each, for LinkedIn's document posts. Built
// from the rendered PNGs, so the pages are exactly the slides.
async function renderPdf(browser: Browser, pngs: string[], file: string) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1350 } });
  const pg = await ctx.newPage();
  await pg.setContent(`<!doctype html><html><head><style>@page { size: 1080px 1350px; margin: 0 }
    html, body { margin: 0 } img { display: block; width: 1080px; height: 1350px; break-after: page }</style></head>
    <body>${pngs.map((f) => `<img src="${dataUri(f)}" alt="">`).join('')}</body></html>`);
  await pg.pdf({ path: file, width: '1080px', height: '1350px', printBackground: true });
  await ctx.close();
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
        if (post.template === 'carousel') {
          const pages = [
            postHtml(post, lang, c, 'feed'),
            ...c.slides.map((_, i) => slideHtml(post, lang, c, i)),
            endSlideHtml(lang),
          ];
          const pngs = pages.map((_, i) => path.join(dir, `${lang}-slide-${String(i + 1).padStart(2, '0')}.png`));
          for (const [i, html] of pages.entries()) await render(browser, html, 1080, 1350, pngs[i]);
          await renderPdf(browser, pngs, path.join(dir, `${lang}-carousel.pdf`));
        }
        writeFileSync(path.join(dir, `${lang}-captions.txt`), captionsFile(post, lang, c));
      }
      console.log(`${post.id}: ${Object.keys(post.copy).join(', ')}`);
    }
  }
} finally {
  await browser.close();
}
