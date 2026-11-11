// docs/74 — short vertical videos of the real app for TikTok, Reels and
// Shorts (D279): a scripted clip per language, recorded from a fresh
// install, framed in the brand template with a one-line hook on top.
//
//   npm run social:videos                              every clip, every language, against :3001
//   npm run social:videos -- --url https://app.myflowtab.com --lang en
//   npm run social:videos -- type-it                   one clip
//
// Writes marketing/out/videos/<lang>/<clip>.mp4 (git-ignored), 1080×1920 at
// 30 fps, silent: add a sound in TikTok or Instagram, where trending audio
// helps reach. Needs ffmpeg on the PATH for MP4 (`brew install ffmpeg`);
// without it the clip is a WebM made with Playwright's own ffmpeg, good for
// checking the flow but not for the apps. Run it on a Mac, like
// screenshots.mts: the app uses system fonts.
//
// How: Chrome's screencast records the app (a frame whenever the screen
// changes), then each output frame is drawn in the brand page and piped to
// ffmpeg as a JPEG. A frame is only redrawn when the app frame changes.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { DEVICE, ENTRIES, settle } from './app.mts';
import { escape, LOGO, page as brandPage } from './brand.mts';
import { LANGUAGES, type Language } from './languages.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FPS = 30;
const W = 1080;
const H = 1920;
const APP = { width: 390, height: 844, scale: 3 };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const baseUrl = arg('url') ?? 'http://localhost:3001';
const only = arg('lang') as Language | undefined;
const flagValues = new Set([arg('url'), arg('lang')]);
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--') && !flagValues.has(a));

// ---- the clips ----

interface Clip {
  hook: Record<Language, string>;
  // 'whole' shows the full phone screen; 'top' zooms in on its top part and
  // lets the phone run off the bottom edge, for screens that are mostly
  // empty below their content.
  view: 'whole' | 'top';
  // Runs before recording starts (the screen it leaves is the first frame).
  setup: (page: Page, lang: Language) => Promise<void>;
  play: (page: Page, lang: Language) => Promise<void>;
}

const CLIPS: Record<string, Clip> = {
  // Type an entry, see what was understood, Save. About 10 s.
  'type-it': {
    hook: {
      en: "Logging a coffee shouldn't take longer than buying it.",
      'pt-BR': 'Anotar um café não devia demorar mais que comprar um.',
      es: 'Anotar un café no debería tardar más que comprarlo.',
      fr: "Noter un café ne devrait pas prendre plus de temps que de l'acheter.",
    },
    view: 'whole',
    async setup(page, lang) {
      // A few entries already there, so the list looks lived-in.
      // Everything but the coffee, which is typed on camera.
      for (const text of ENTRIES[lang].filter((_, i) => i !== 1).reverse()) await quickEntry(page, text);
      await page.locator('.toast').waitFor({ state: 'hidden', timeout: 7000 });
    },
    async play(page, lang) {
      await page.waitForTimeout(1000);
      const input = entryInput(page);
      await tap(page, input);
      await input.pressSequentially(ENTRIES[lang][1], { delay: 110 });
      await page.waitForTimeout(500);
      await input.press('Enter');
      await page.locator('.parse-confirm').waitFor({ timeout: 5000 });
      await page.waitForTimeout(2200);
      await tap(page, page.locator('.parse-confirm'));
      await page.waitForTimeout(2500);
    },
  },
  // Tap through the languages; the screen re-labels itself each time, and
  // ends back in the clip's own language. About 12 s.
  languages: {
    hook: {
      en: 'Your money, your language.',
      'pt-BR': 'Seu dinheiro, no seu idioma.',
      es: 'Tu dinero, en tu idioma.',
      fr: 'Votre argent, dans votre langue.',
    },
    view: 'top',
    async setup(page) {
      await page.goto(new URL('/settings/language', baseUrl).href);
      await settle(page);
    },
    async play(page, lang) {
      await page.waitForTimeout(1000);
      const own = DEVICE[lang].tag;
      const tour = ['en', 'pt-BR', 'es', 'fr-CA', 'ja', 'ko', 'zh-Hans'].filter((t) => t !== own);
      for (const tag of [...tour, own]) {
        await tap(page, page.locator(`button.chip[lang="${tag}"]`));
        await page.waitForTimeout(1200);
      }
      await tap(page, page.locator('.back-link'));
      await page.waitForTimeout(2500);
    },
  },
  // Three entries typed and saved back to back on an empty Home, which
  // fills up as they go. The hook promises 15 s: keep play() under it.
  'three-entries': {
    hook: {
      en: 'Three spends. Fifteen seconds.',
      'pt-BR': 'Três gastos. Quinze segundos.',
      es: 'Tres gastos. Quince segundos.',
      fr: 'Trois dépenses. Quinze secondes.',
    },
    view: 'whole',
    async setup() {},
    async play(page, lang) {
      await page.waitForTimeout(700);
      const [groceries, coffee, ride] = ENTRIES[lang];
      for (const text of [coffee, ride, groceries]) {
        const input = entryInput(page);
        await tap(page, input);
        await input.pressSequentially(text, { delay: 70 });
        await input.press('Enter');
        await page.locator('.parse-confirm').waitFor({ timeout: 5000 });
        await page.waitForTimeout(900);
        await tap(page, page.locator('.parse-confirm'));
        await page.waitForTimeout(700);
      }
      await page.waitForTimeout(1300);
    },
  },
};

// ---- driving the app ----

const entryInput = (page: Page) =>
  page.locator('.entry-zone-dock input[type="text"], .entry-zone-dock input:not([type])').first();

async function quickEntry(page: Page, text: string) {
  const input = entryInput(page);
  await input.fill(text);
  await input.press('Enter');
  await page.locator('.parse-confirm').click();
  await page.waitForTimeout(500);
}

// A finger-sized ripple where the tap lands, so viewers can follow along.
async function tap(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (box) {
    await page.evaluate(({ x, y }) => {
      const dot = document.createElement('div');
      dot.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;
        background:rgba(15,26,23,.22);pointer-events:none;z-index:99999;transition:transform .45s,opacity .45s`;
      document.body.appendChild(dot);
      requestAnimationFrame(() => requestAnimationFrame(() => { dot.style.transform = 'scale(1.6)'; dot.style.opacity = '0'; }));
      setTimeout(() => dot.remove(), 600);
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await page.waitForTimeout(150);
  }
  await target.click();
}

// ---- recording ----

interface Frame { t: number; jpeg: string }

async function record(browser: Browser, lang: Language, clip: Clip): Promise<Frame[]> {
  const ctx = await browser.newContext({
    viewport: { width: APP.width, height: APP.height },
    deviceScaleFactor: APP.scale,
    locale: DEVICE[lang].locale,
    timezoneId: DEVICE[lang].timezoneId,
    colorScheme: 'light',
  });
  await ctx.addInitScript((tag) => localStorage.setItem('flowtab:language', tag), DEVICE[lang].tag);
  const page = await ctx.newPage();
  await page.goto(baseUrl);
  await settle(page);
  await clip.setup(page, lang);

  const frames: Frame[] = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', (e) => {
    frames.push({ t: e.metadata.timestamp ?? Date.now() / 1000, jpeg: e.data });
    cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 92, maxWidth: APP.width * APP.scale, maxHeight: APP.height * APP.scale,
  });
  const start = Date.now() / 1000;
  await clip.play(page, lang);
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await ctx.close();
  if (!frames.length) throw new Error(`${lang}: the screencast sent no frames`);
  // Times relative to the start; a still screen sends nothing, so the
  // first frame stands in from 0 and the last one holds to the end.
  const t0 = Math.min(start, frames[0].t);
  return [...frames.map((f) => ({ t: f.t - t0, jpeg: f.jpeg })), { t: end - t0, jpeg: frames[frames.length - 1].jpeg }];
}

// ---- framing and encoding ----

function frameHtml(lang: Language, hook: string, view: Clip['view']): string {
  // Whole: short enough that a three-line hook still leaves the entry bar
  // on screen. Top: about 1.6× larger, cut off by the frame's bottom edge.
  const phoneW = view === 'whole' ? 560 : 900;
  const height = view === 'whole' ? `${Math.round(phoneW * (APP.height / APP.width))}px` : 'calc(100% + 120px)';
  return brandPage(lang, W, H, '--pad: 120px 90px 0; --h1: 84px;',
    `<img class="logo" src="${LOGO}" alt="" style="margin-bottom:64px">
    <h1>${escape(hook)}</h1>
    <div style="flex:1;min-height:0;position:relative;margin-top:72px">
      <div class="phone" style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:${phoneW}px;height:${height}">
        <img id="screen" alt="" style="object-position:top">
      </div></div>`);
}

function findFfmpeg(): { bin: string; mp4: boolean } {
  if (process.env.FFMPEG) return { bin: process.env.FFMPEG, mp4: true };
  if (spawnSync('ffmpeg', ['-version']).status === 0) return { bin: 'ffmpeg', mp4: true };
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Caches/ms-playwright') : path.join(os.homedir(), '.cache/ms-playwright'));
  for (const dir of existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('ffmpeg-')) : []) {
    for (const name of ['ffmpeg-linux', 'ffmpeg-mac']) {
      const bin = path.join(cache, dir, name);
      if (existsSync(bin)) return { bin, mp4: false };
    }
  }
  throw new Error('No ffmpeg: install it (brew install ffmpeg) or run npx playwright install ffmpeg');
}

async function encode(browser: Browser, lang: Language, clip: Clip, frames: Frame[], file: string, ff: { bin: string; mp4: boolean }) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(frameHtml(lang, clip.hook[lang], clip.view), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const out = ff.mp4
    ? ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart']
    : ['-c:v', 'vp8', '-b:v', '6M', '-crf', '4', '-qmin', '0', '-qmax', '40'];
  const proc = spawn(ff.bin, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', ...out, file], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const done = new Promise<void>((resolve, reject) =>
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));

  const total = Math.ceil(frames[frames.length - 1].t * FPS);
  let shown = -1;
  let jpeg: Buffer | null = null;
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    let k = shown < 0 ? 0 : shown;
    while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
    if (k !== shown || !jpeg) {
      shown = k;
      await page.evaluate(async (src) => {
        const img = document.getElementById('screen') as HTMLImageElement;
        img.src = src;
        await img.decode();
      }, `data:image/jpeg;base64,${frames[k].jpeg}`);
      jpeg = await page.screenshot({ type: 'jpeg', quality: 94 });
    }
    if (!proc.stdin.write(jpeg)) await new Promise((r) => proc.stdin.once('drain', r));
  }
  proc.stdin.end();
  await done;
  await ctx.close();
}

const ff = findFfmpeg();
if (!ff.mp4) console.warn('No ffmpeg on the PATH: writing WebM with Playwright\'s ffmpeg (fine for checking, not for posting). brew install ffmpeg for MP4.');
const clips = Object.entries(CLIPS).filter(([name]) => !wanted.length || wanted.includes(name));
if (wanted.length && !clips.length) throw new Error(`No clip named ${wanted.join(', ')}; clips: ${Object.keys(CLIPS).join(', ')}`);

const browser = await chromium.launch();
try {
  for (const lang of only ? [only] : LANGUAGES) {
    const dir = path.join(root, 'marketing/out/videos', lang);
    mkdirSync(dir, { recursive: true });
    for (const [name, clip] of clips) {
      const frames = await record(browser, lang, clip);
      const file = path.join(dir, `${name}.${ff.mp4 ? 'mp4' : 'webm'}`);
      await encode(browser, lang, clip, frames, file, ff);
      console.log(`${lang}: ${path.relative(root, file)} (${frames[frames.length - 1].t.toFixed(1)} s)`);
    }
  }
} finally {
  await browser.close();
}
