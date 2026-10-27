/** Conservative OTA compatibility check. Only package scripts may change without a rebuild. */
const { execFileSync } = require('node:child_process');
function git(...args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
function requiresNativeBuild(before, after, read = git) {
  const files = read('diff', '--name-only', before, after, '--').split('\n').filter(Boolean);
  for (const file of files) {
    if (/^(android|ios)\//.test(file) || /^(package-lock\.json|app\.json|app\.config\.[jt]s|eas\.json)$/.test(file)) return true;
    if (file === 'package.json') {
      try {
        const previous = JSON.parse(read('show', `${before}:package.json`));
        const current = JSON.parse(read('show', `${after}:package.json`));
        delete previous.scripts;
        delete current.scripts;
        if (JSON.stringify(previous) !== JSON.stringify(current)) return true;
      } catch { return true; }
    }
  }
  return false;
}
module.exports = { requiresNativeBuild };
if (require.main === module) {
  let before = process.argv[2];
  const after = process.argv[3];
  if (!/^[0-9a-f]{40,64}$/i.test(after ?? '')) throw new Error('Expected a commit SHA.');
  try {
    if (!/^[0-9a-f]{40,64}$/i.test(before ?? '') || /^0+$/.test(before)) throw new Error('Missing previous commit');
    git('cat-file', '-e', `${before}^{commit}`);
  } catch { before = git('rev-parse', `${after}^`); }
  console.log(String(requiresNativeBuild(before, after)));
}
