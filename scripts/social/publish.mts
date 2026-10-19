// docs/74 — schedules approved posts on the networks through Ayrshare
// (D278), one request per post and language. Dry run by default: it prints
// what it would send and changes nothing.
//
//   npm run social:publish                    dry run, posts dated from today on
//   npm run social:publish -- --from 2026-10-20 --days 14
//   npm run social:publish -- --send          really schedule them
//
// Needs, for --send:
//   AYRSHARE_API_KEY   the account's API key
//   MEDIA_BASE_URL     public https base the composed images are uploaded to,
//                      laid out like marketing/out/posts/ (<id>/<lang>-feed.png).
//                      Every image is checked with a HEAD request first.
//
// A post goes out only when its language is in `approved:` and
// marketing/channels.json gives that language an account. Each scheduled
// post is recorded in marketing/published.json (commit it), so running
// again never schedules the same post twice.
//
// Untested against the real API: written from Ayrshare's docs
// (POST https://api.ayrshare.com/api/post) before an account existed. Do the
// first --send with one post and check it in Ayrshare's dashboard.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from './languages.mts';
import { loadPosts, type Platform, type Post } from './posts.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER = path.join(root, 'marketing/published.json');

interface Channel {
  profileKeyEnv: string | null;
  time: string; // HH:MM
  timeZone: string;
}
type Ledger = Record<string, { scheduledFor: string; platforms: Platform[]; ayrshareId: string | null }>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const send = process.argv.includes('--send');

// Image posts can't go to TikTok or YouTube through this path: both want a
// video (D279). They stay in a post's platforms: for when it gets one.
const NEEDS_VIDEO: Platform[] = ['tiktok', 'youtube'];
// Ayrshare's names, where ours differ.
const AYRSHARE_NAME: Partial<Record<Platform, string>> = { x: 'twitter' };

// "2026-10-21" 09:00 in America/Vancouver → UTC ISO. Takes the zone's
// offset at that moment from Intl, so daylight saving is handled.
function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asZone = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asZone - guess)).toISOString();
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const from = arg('from') ?? today();
const days = Number(arg('days') ?? 30);
const until = new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const channels = JSON.parse(readFileSync(path.join(root, 'marketing/channels.json'), 'utf8')) as Record<string, Channel | null | string>;
const ledger: Ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
const posts = loadPosts(path.join(root, 'marketing/posts')).filter((p) => p.date >= from && p.date < until);

const apiKey = process.env.AYRSHARE_API_KEY;
const mediaBase = process.env.MEDIA_BASE_URL?.replace(/\/$/, '');
if (send && (!apiKey || !mediaBase)) throw new Error('--send needs AYRSHARE_API_KEY and MEDIA_BASE_URL');

async function schedule(post: Post, lang: Language, channel: Channel) {
  const key = `${post.id}/${lang}`;
  if (ledger[key]) return console.log(`  ${key}: already scheduled for ${ledger[key].scheduledFor}`);
  const copy = post.copy[lang]!;
  const skipped = post.platforms.filter((p) => NEEDS_VIDEO.includes(p));
  const platforms = post.platforms.filter((p) => !NEEDS_VIDEO.includes(p));
  if (!platforms.length) return console.log(`  ${key}: only video platforms (${skipped.join(', ')}), skipped`);
  const scheduleDate = zonedToUtc(post.date, channel.time, channel.timeZone);
  const local = path.join(root, 'marketing/out/posts', post.id, `${lang}-feed.png`);
  if (!existsSync(local)) throw new Error(`${key}: no ${path.relative(root, local)} — run npm run social:compose`);
  const mediaUrl = `${mediaBase ?? '<MEDIA_BASE_URL>'}/${post.id}/${lang}-feed.png`;

  console.log(`  ${key}: ${scheduleDate} → ${platforms.join(', ')}${skipped.length ? ` (no video: ${skipped.join(', ')} skipped)` : ''}`);
  if (!send) return;

  const head = await fetch(mediaUrl, { method: 'HEAD' });
  if (!head.ok) throw new Error(`${key}: ${mediaUrl} answered ${head.status}; upload marketing/out/posts first`);
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (channel.profileKeyEnv) {
    const profileKey = process.env[channel.profileKeyEnv];
    if (!profileKey) throw new Error(`${key}: ${channel.profileKeyEnv} is not set`);
    headers['Profile-Key'] = profileKey;
  }
  const res = await fetch('https://api.ayrshare.com/api/post', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      post: copy.caption,
      platforms: platforms.map((p) => AYRSHARE_NAME[p] ?? p),
      mediaUrls: [mediaUrl],
      scheduleDate,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!res.ok || body.status === 'error') throw new Error(`${key}: Ayrshare ${res.status} ${JSON.stringify(body)}`);
  ledger[key] = { scheduledFor: scheduleDate, platforms, ayrshareId: body.id ?? null };
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
}

console.log(`${send ? 'Scheduling' : 'Dry run'}: posts dated ${from} to ${until} (exclusive)`);
for (const post of posts) {
  console.log(post.id);
  if (!post.approved.length) console.log('  nothing approved yet');
  for (const lang of post.approved) {
    const channel = channels[lang];
    if (!channel || typeof channel === 'string') {
      console.log(`  ${post.id}/${lang}: no ${lang} account in marketing/channels.json, skipped`);
      continue;
    }
    await schedule(post, lang, channel);
  }
}
