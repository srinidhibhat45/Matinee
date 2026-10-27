const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const workflows = ['ota-update.yml', 'build-apk.yml'].map(name => YAML.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8')));
for (const workflow of workflows) {
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) {
    if (step.run) {
      const syntax = spawnSync('bash', ['-n'], { input: step.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'event-value'), encoding: 'utf8' });
      assert.equal(syntax.status, 0, `${workflow.name}: ${step.name}: ${syntax.stderr}`);
    }
    assert.ok(!step.uses?.startsWith('expo/expo-github-action'), 'Do not reintroduce the failed Yarn installer.');
  }
}
const publish = workflows[0].jobs.publish.steps.find(s => s.name === 'Publish update');
const tokenCheck = workflows[0].jobs.publish.steps.find(s => s.name === 'Check Expo token');
assert.equal(publish.shell, 'bash');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-workflow-'));
try {
  const mock = path.join(temp, 'eas');
  fs.writeFileSync(mock, '#!/bin/bash\nprintf "%s\\n" "$@" > "$ARGUMENTS_FILE"\nif [ "${FAIL_PUBLISH:-0}" = "1" ]; then exit 17; fi\nprintf \'[{"id":"test-update","platform":"android","runtimeVersion":"1.1.0"}]\\n\'\n');
  fs.chmodSync(mock, 0o755);
  const sentinel = path.join(temp, 'must-not-exist');
  const message = `Fix deployment $(touch ${sentinel}) \`false\` "quotes"\nLong body`;
  const env = { ...process.env, PATH: `${temp}${path.delimiter}${process.env.PATH}`, ARGUMENTS_FILE: path.join(temp, 'arguments'), BRANCH_INPUT: '', ENVIRONMENT_INPUT: '', COMMIT_MESSAGE: message };
  const run = extra => spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', publish.run], { cwd: temp, env: { ...env, ...extra }, encoding: 'utf8' });
  const success = run({});
  assert.equal(success.status, 0, success.stderr);
  const args = fs.readFileSync(env.ARGUMENTS_FILE, 'utf8').trim().split('\n');
  for (const [flag, value] of [['--branch','preview'], ['--platform','android'], ['--environment','preview']]) assert.equal(args[args.indexOf(flag)+1], value);
  assert.equal(args[args.indexOf('--message')+1], message.split('\n')[0]);
  assert.equal(fs.existsSync(sentinel), false, 'Commit messages must not execute shell code.');
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'ota-update.json'), 'utf8'))[0].id, 'test-update');
  assert.equal(run({ FAIL_PUBLISH: '1' }).status, 17, 'tee must not hide a failed EAS publish.');
  const missingToken = spawnSync('bash', ['-e', '-c', tokenCheck.run], { env: { ...env, EXPO_TOKEN: '' }, encoding: 'utf8' });
  assert.notEqual(missingToken.status, 0);
  assert.match(missingToken.stdout, /EXPO_TOKEN is missing/);
  console.log('Workflow YAML, shell syntax, OTA arguments, message safety, token validation and failure propagation checks passed.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
