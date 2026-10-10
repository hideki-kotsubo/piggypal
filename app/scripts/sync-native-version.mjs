#!/usr/bin/env node
// Stamps app/package.json's version onto the native iOS/Android projects
// before a store build, and bumps each platform's own build-number counter
// (versionCode / CURRENT_PROJECT_VERSION) — those must strictly increase on
// every submitted build regardless of the marketing version, per App
// Store/Play Store rules. Run via `npm run release:android` / `npm run
// release:ios` (docs/55, docs/58 D222), not directly — and only for a build
// you're actually submitting. Plain `sync:*` no longer calls this, so dev
// syncs don't burn build numbers.
//
// The project file is the only record of the last build number, so the bump
// is committed and pushed to main right here (docs/66): an uncommitted bump
// gets lost and the next release reuses a number the store already has.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];

if (!['android', 'ios'].includes(platform)) {
  console.error('Usage: node scripts/sync-native-version.mjs <android|ios>');
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { cwd: appRoot, encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const projectFile = {
  android: 'android/app/build.gradle',
  ios: 'ios/App/App.xcodeproj/project.pbxproj',
}[platform];
const projectPath = path.join(appRoot, projectFile);

if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') {
  fail('Not on main — store builds are released from main. Switch to main and re-run.');
}

if (git('status', '--porcelain', '--', projectFile)) {
  fail(
    `app/${projectFile} has uncommitted changes. Commit them (or discard them)\n` +
      'first, so this build number bump goes in a commit of its own.',
  );
}

const headBefore = git('rev-parse', 'HEAD');
try {
  execFileSync('git', ['pull', '--ff-only'], { cwd: appRoot, stdio: 'inherit' });
} catch {
  fail('git pull failed (see above), nothing was bumped.');
}
if (git('rev-parse', 'HEAD') !== headBefore) {
  fail(
    'git pull brought in new commits, so app/dist is out of date. Run\n' +
      '`npm ci` and `npm run build -w app` again, then re-run this release.',
  );
}

const { version: marketingVersion } = JSON.parse(
  readFileSync(path.join(appRoot, 'package.json'), 'utf8'),
);

let project = readFileSync(projectPath, 'utf8');
let newCode;

if (platform === 'android') {
  const match = project.match(/versionCode (\d+)/);
  if (!match) throw new Error(`versionCode not found in ${projectPath}`);
  newCode = Number(match[1]) + 1;

  project = project.replace(/versionCode \d+/, `versionCode ${newCode}`);
  project = project.replace(/versionName "[^"]*"/, `versionName "${marketingVersion}"`);

  console.log(`android: versionName "${marketingVersion}", versionCode ${newCode}`);
}

if (platform === 'ios') {
  const match = project.match(/CURRENT_PROJECT_VERSION = (\d+);/);
  if (!match) throw new Error(`CURRENT_PROJECT_VERSION not found in ${projectPath}`);
  newCode = Number(match[1]) + 1;

  project = project.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${newCode};`);
  project = project.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${marketingVersion};`);

  console.log(`ios: MARKETING_VERSION ${marketingVersion}, CURRENT_PROJECT_VERSION ${newCode}`);
}

writeFileSync(projectPath, project);

// `commit -- <path>` commits only that file, whatever else happens to be staged.
git('commit', '-q', '-m', `${platform}: build ${marketingVersion} (${newCode})`, '--', projectFile);
try {
  execFileSync('git', ['push', 'origin', 'main'], { cwd: appRoot, stdio: 'inherit' });
} catch {
  console.warn(
    `\nCommitted the bump locally, but the push failed. Run \`git push origin main\`\n` +
      'before the next release, or another machine may reuse this build number.',
  );
}
