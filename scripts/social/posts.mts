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
//   caption:
//   Everything after "caption:" up to the next "## " is the caption,
//   hashtags included.
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
    const c: PostCopy = { headline: '', sub: '', bullets: [], caption: '' };
    let field: 'bullets' | 'caption' | null = null;
    const caption: string[] = [];
    for (const line of lines) {
      if (field === 'caption') {
        caption.push(line);
        continue;
      }
      const kv = /^(headline|sub|bullets|caption):\s*(.*)$/.exec(line);
      if (kv) {
        if (kv[1] === 'headline' || kv[1] === 'sub') c[kv[1]] = kv[2].trim();
        else field = kv[1] as 'bullets' | 'caption';
        if (kv[1] === 'caption' && kv[2].trim()) caption.push(kv[2]);
      } else if (field === 'bullets' && /^- /.test(line)) c.bullets.push(line.slice(2).trim());
    }
    c.caption = caption.join('\n').trim();
    if (!c.headline) throw new Error(`${where}: ## ${lang} has no headline`);
    copy[lang] = c;
  }
  for (const l of approved as Language[]) {
    if (!copy[l]) throw new Error(`${where}: ${l} is approved but has no ## ${l} section`);
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

export function loadPosts(dir: string): Post[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .sort()
    .map((f) => parsePost(readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f)));
}
