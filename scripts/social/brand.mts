// docs/74 — the brand look shared by compose.mts (images) and videos.mts:
// the website's palette and type as one HTML page per frame.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from './languages.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const dataUri = (file: string) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
export const LOGO = dataUri(path.join(root, 'docs/logo/v2-logo.png'));
export const ICON = dataUri(path.join(root, 'docs/logo/v2-icon.png'));

export const escape = (s: string) =>
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

export function page(lang: Language, w: number, h: number, vars: string, body: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">${FONTS}
<style>${BASE_CSS} body { --w: ${w}px; --h: ${h}px; ${vars} }</style></head>
<body><div class="page">${body}</div></body></html>`;
}
