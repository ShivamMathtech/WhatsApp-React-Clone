import './check-node.mjs';
import { existsSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
if (!existsSync('.env')) copyFileSync('.env.example', '.env');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [
  ['ci', '--include=dev', '--no-fund'],
  ['run', 'build'],
  ['run', 'seed'],
]) {
  console.log(`\n> npm ${args.join(' ')}\n`);
  const result = spawnSync(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) {
    console.error(
      result.error?.message ||
        `Setup stopped: npm ${args.join(' ')} failed. Fix the error above and rerun setup.`,
    );
    process.exit(result.status || 1);
  }
}
console.log(
  '\nSetup complete. Run start_windows.bat or npm start.\nOpen http://localhost:3001\nDemo: shivam@demo.local / DemoChat@123\n',
);
