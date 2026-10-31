/** Smoke-test each standalone public-API example as a separate Node.js process. */
import { spawnSync } from 'node:child_process';

for (const number of ['01-gzip-file', '02-aes-256-gcm', '03-sha256-stream',
  '04-compress-encrypt-hash', '05-custom-transform', '06-worker-pipeline',
  '07-errors-abort']) {
  const file = 'examples/' + number + '.mjs';
  const result = spawnSync(process.execPath, [file], {
    stdio: 'inherit',
    timeout: 30_000,
    windowsHide: true,
    env: { ...process.env, PIPEX_KEY_HEX: undefined },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Example failed: ' + file);
}
console.log('All seven PipeX examples passed.');
