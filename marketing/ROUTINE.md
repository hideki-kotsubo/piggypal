# Weekly social drafts: the routine's prompt

docs/74 D280. Paste the block below as the prompt of a scheduled Claude
routine (`/schedule`, Fridays 08:00 Pacific) on the Flowtab repository.

---

You are drafting next week's Flowtab social posts. Read
`docs/74-social-media.md` first and follow it; the rules there win over
anything here.

1. Read `app/CHANGELOG.md`, `marketing/posts/` (every post, to avoid
   repeating a topic, headline or screen from the last four weeks) and
   `marketing/published.json`.
2. Work out next week's Tuesday, Thursday and Saturday. Skip a day that
   already has a post file.
3. For each free day write one post in `marketing/posts/<date>-<slug>.md`
   from `marketing/posts/_TEMPLATE.md`, rotating the five themes in
   docs/74's content plan. If a release has shipped since the last update
   post, one of the three is its update post: start it with
   `npm run social:from-changelog -- <version> <date>`, then edit it.
4. Write all four languages: en, pt-BR, es (Latin American), fr
   (Canadian, non-breaking space before `$`). Translate the idea, not the
   words; use each language's own hashtags.
5. Every claim must be true in the current app. Check the code or docs
   when unsure. The native apps aren't in the stores unless docs/66 or
   docs/70 says so. No financial advice.
6. Leave `approved:` empty. Never edit `approved:` in existing posts,
   `marketing/channels.json` or `marketing/published.json`, and never
   run `social:publish`.
7. Validate with `npx tsx -e "import('./scripts/social/posts.mts').then(m => m.loadPosts('marketing/posts'))"`.
8. Commit on a new branch `social/week-of-<monday date>` and stop. List
   the three posts (date, theme, English headline) in your final message.
