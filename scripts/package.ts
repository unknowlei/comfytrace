import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const release = new URL('release/', root);
await mkdir(release, { recursive: true });
const html = await readFile(new URL('dist/index.html', root));
const target = new URL('ComfyTrace.html', release);
await writeFile(target, html);
await copyFile(new URL('LICENSE', root), new URL('LICENSE', release));
await copyFile(new URL('docs/QUICKSTART.zh-CN.txt', root), new URL('使用说明.txt', release));

const packages = ['react', 'react-dom', 'scheduler', 'lucide-react'];
const notices: string[] = ['ComfyTrace third-party notices', ''];
for (const name of packages) {
  const pkg = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root), 'utf8'));
  notices.push(`${name} ${pkg.version} (${pkg.license})`, '');
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { notices.push(await readFile(new URL(`node_modules/${name}/${filename}`, root), 'utf8'), ''); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
await writeFile(new URL('THIRD-PARTY-NOTICES.txt', release), notices.join('\n'), 'utf8');
const sha = createHash('sha256').update(html).digest('hex');
await writeFile(new URL('SHA256SUMS.txt', release), `${sha}  ComfyTrace.html\n`, 'utf8');
process.stdout.write(`Packaged ${fileURLToPath(target)} (${html.length} bytes)\nSHA-256 ${sha}\n`);
