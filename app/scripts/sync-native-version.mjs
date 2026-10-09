#!/usr/bin/env node
// Stamps app/package.json's version onto the native iOS/Android projects
// before a store build, and bumps each platform's own build-number counter
// (versionCode / CURRENT_PROJECT_VERSION) — those must strictly increase on
// every submitted build regardless of the marketing version, per App
// Store/Play Store rules. Run via `npm run release:android` / `npm run
// release:ios` (docs/55, docs/58 D222), not directly — and only for a build
// you're actually submitting. Plain `sync:*` no longer calls this, so dev
// syncs don't burn build numbers.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];

if (!['android', 'ios'].includes(platform)) {
  console.error('Usage: node scripts/sync-native-version.mjs <android|ios>');
  process.exit(1);
}

const { version: marketingVersion } = JSON.parse(
  readFileSync(path.join(appRoot, 'package.json'), 'utf8'),
);

if (platform === 'android') {
  const gradlePath = path.join(appRoot, 'android/app/build.gradle');
  let gradle = readFileSync(gradlePath, 'utf8');

  const match = gradle.match(/versionCode (\d+)/);
  if (!match) throw new Error(`versionCode not found in ${gradlePath}`);
  const newCode = Number(match[1]) + 1;

  gradle = gradle.replace(/versionCode \d+/, `versionCode ${newCode}`);
  gradle = gradle.replace(/versionName "[^"]*"/, `versionName "${marketingVersion}"`);
  writeFileSync(gradlePath, gradle);

  console.log(`android: versionName "${marketingVersion}", versionCode ${newCode}`);
}

if (platform === 'ios') {
  const pbxprojPath = path.join(appRoot, 'ios/App/App.xcodeproj/project.pbxproj');
  let pbxproj = readFileSync(pbxprojPath, 'utf8');

  const match = pbxproj.match(/CURRENT_PROJECT_VERSION = (\d+);/);
  if (!match) throw new Error(`CURRENT_PROJECT_VERSION not found in ${pbxprojPath}`);
  const newCode = Number(match[1]) + 1;

  pbxproj = pbxproj.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${newCode};`);
  pbxproj = pbxproj.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${marketingVersion};`);
  writeFileSync(pbxprojPath, pbxproj);

  console.log(`ios: MARKETING_VERSION ${marketingVersion}, CURRENT_PROJECT_VERSION ${newCode}`);
}
