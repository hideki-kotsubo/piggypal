// docs/74 — one post = one Markdown file in marketing/posts/, all four
// languages side by side so a reviewer sees them together:
//
//   ---
//   date: 2026-10-21            the day it should go out (local time)
//   template: feature           feature | tip | update
//   screen: 02-understood       a screenshots.mts name (feature, update)
//   crop: bottom                which part of the screenshot shows: top | bottom
//   platforms: instagram, facebook, tiktok, threads, linkedin
//   approved: en, pt-BR         languages cleared to publish (D275)
//   ---
//
//   ## en
//   headline: Type it or say it.
//   sub: It's on the tab.
//   bullets:                    (update template only, one "- " per line)
//   - First thing
//   alt: What the image shows, for screen readers (one line).
//   short:
//   The X and Bluesky text, link included, until "caption:". Needed when
//   the post goes to x or bluesky; at most 280 as X counts (links 23,
//   CJK and emoji 2 each) and 300 characters for Bluesky.
//   caption:
//   Everything after "caption:" up to the next "## " is the caption,
//   hashtags included. Written for Instagram ("Link in bio");
//   captionFor() turns it into the Facebook/LinkedIn text.
//
// Nothing is published unless its language is in `approved`. Drafts made by
// a person or by Claude start with `approved:` empty or English-only.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isLanguage, type Language } from './languages.mts';

export const TEMPLATES = ['feature', 'tip', 'update'] as const;
export type Template = (typeof TEMPLATES)[number];
export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'threads', 'linkedin', 'youtube', 'x', 'bluesky'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface PostCopy {
  headline: string;
  sub: string;
  bullets: string[];
  alt: string;
  short: string;
  caption: string;
}

export interface Post {
  id: string; // file name without .md
  file: string;
  date: string;
  template: Template;
  screen: string | null;
  crop: 'top' | 'bottom';
  platforms: Platform[];
  approved: Language[];
  copy: Partial<Record<Language, PostCopy>>;
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function parsePost(source: string, file: string): Post {
  const where = path.basename(file);
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source.replace(/\r\n/g, '\n'));
  if (!m) throw new Error(`${where}: missing --- front matter ---`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z]+):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (kv) meta[kv[1]] = kv[2];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date ?? '')) throw new Error(`${where}: date must be YYYY-MM-DD`);
  const template = meta.template as Template;
  if (!TEMPLATES.includes(template)) throw new Error(`${where}: template must be ${TEMPLATES.join(' | ')}`);
  const platforms = list(meta.platforms) as Platform[];
  for (const p of platforms) if (!PLATFORMS.includes(p)) throw new Error(`${where}: unknown platform ${p}`);
  const approved = list(meta.approved);
  for (const l of approved) if (!isLanguage(l)) throw new Error(`${where}: unknown language ${l} in approved`);

  const copy: Post['copy'] = {};
  for (const section of m[2].split(/^## /m).slice(1)) {
    const [heading, ...lines] = section.split('\n');
    const lang = heading.trim();
    if (!isLanguage(lang)) throw new Error(`${where}: unknown language section "## ${lang}"`);
    const c: PostCopy = { headline: '', sub: '', bullets: [], alt: '', short: '', caption: '' };
    let field: 'bullets' | 'short' | 'caption' | null = null;
    const block = { short: [] as string[], caption: [] as string[] };
    for (const line of lines) {
      if (field === 'caption') {
        block.caption.push(line);
        continue;
      }
      const kv = /^(headline|sub|alt|bullets|short|caption):\s*(.*)$/.exec(line);
      if (kv) {
        if (kv[1] === 'headline' || kv[1] === 'sub' || kv[1] === 'alt') {
          c[kv[1]] = kv[2].trim();
          field = null;
        } else field = kv[1] as 'bullets' | 'short' | 'caption';
        if ((kv[1] === 'short' || kv[1] === 'caption') && kv[2].trim()) block[kv[1]].push(kv[2]);
      } else if (field === 'bullets' && /^- /.test(line)) c.bullets.push(line.slice(2).trim());
      else if (field === 'short') block.short.push(line);
    }
    c.short = block.short.join('\n').trim();
    c.caption = block.caption.join('\n').trim();
    if (!c.headline) throw new Error(`${where}: ## ${lang} has no headline`);
    if (c.short) {
      if (xLength(c.short) > 280) throw new Error(`${where}: ## ${lang} short: is ${xLength(c.short)} long on X (max 280)`);
      if (graphemes(c.short) > 300) throw new Error(`${where}: ## ${lang} short: is ${graphemes(c.short)} characters (Bluesky max 300)`);
    }
    copy[lang] = c;
  }
  const needsShort = platforms.some((p) => p === 'x' || p === 'bluesky');
  for (const l of approved as Language[]) {
    if (!copy[l]) throw new Error(`${where}: ${l} is approved but has no ## ${l} section`);
    if (needsShort && !copy[l]!.short) throw new Error(`${where}: ${l} is approved for x/bluesky but has no short:`);
  }
  if (template !== 'tip' && !meta.screen) throw new Error(`${where}: a ${template} post needs screen:`);

  return {
    id: path.basename(file, '.md'),
    file,
    date: meta.date,
    template,
    screen: meta.screen || null,
    crop: meta.crop === 'bottom' ? 'bottom' : 'top',
    platforms,
    approved: approved as Language[],
    copy,
  };
}

const graphemes = (text: string) => [...new Intl.Segmenter().segment(text)].length;

// X's weighted count: links are 23, Latin and common punctuation 1, CJK,
// emoji and everything else 2.
export function xLength(text: string): number {
  let n = 0;
  for (const part of text.split(/(https?:\/\/\S+)/)) {
    if (/^https?:\/\//.test(part)) n += 23;
    else
      for (const ch of part) {
        const cp = ch.codePointAt(0)!;
        const light = cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
        n += light ? 1 : 2;
      }
  }
  return n;
}

// Facebook and LinkedIn show links, so "Link in bio" becomes the link (or
// the link is added before the hashtags), and three hashtags are plenty.
const SITE = 'https://myflowtab.com';
const LINK_IN_BIO: Record<Language, [RegExp, string]> = {
  en: [/Link in bio\./, `Try it free: ${SITE}`],
  'pt-BR': [/Link na bio\./, `Teste grátis: ${SITE}`],
  es: [/Link en la bio\./, `Pruébalo gratis: ${SITE}`],
  fr: [/Lien dans la bio\./, `Essayez-le gratuitement : ${SITE}`],
};

export function captionFor(copy: PostCopy, lang: Language, platform: Platform): string {
  if (platform === 'x' || platform === 'bluesky') return copy.short;
  if (platform !== 'facebook' && platform !== 'linkedin') return copy.caption;
  const [bio, link] = LINK_IN_BIO[lang];
  let text = copy.caption.replace(/^(#\S+\s*)+$/m, (tags) => tags.trim().split(/\s+/).slice(0, 3).join(' '));
  if (bio.test(text)) return text.replace(bio, link);
  const tags = /\n\n(#\S+( #\S+)*)$/.exec(text);
  return tags ? `${text.slice(0, tags.index)}\n\n${link}${tags[0]}` : `${text}\n\n${link}`;
}

export function loadPosts(dir: string): Post[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .sort()
    .map((f) => parsePost(readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f)));
}
