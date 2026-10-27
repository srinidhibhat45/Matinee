const assert = require('node:assert/strict');
const { requiresNativeBuild } = require('../scripts/native-changes.cjs');
const check = (files, before, after) => requiresNativeBuild('before', 'after', (...args) =>
  args[0] === 'diff' ? files : JSON.stringify(args[1].startsWith('before:') ? before : after));
assert.equal(check('package.json', { dependencies: { expo: '56' }, scripts: { test: 'old' } }, { dependencies: { expo: '56' }, scripts: { test: 'new' } }), false);
assert.equal(check('package.json', { dependencies: { expo: '55' } }, { dependencies: { expo: '56' } }), true);
assert.equal(check('package.json', {}, { overrides: { react: '19' } }), true);
for (const file of ['package-lock.json', 'app.json', 'app.config.ts', 'eas.json', 'android/build.gradle', 'ios/Podfile']) assert.equal(check(file, {}, {}), true);
assert.equal(check('services/database.ts', {}, {}), false);
assert.equal(requiresNativeBuild('before', 'after', (...args) => { if (args[0] === 'diff') return 'package.json'; throw Error('Missing package'); }), true);
console.log('OTA compatibility guard checks passed.');
