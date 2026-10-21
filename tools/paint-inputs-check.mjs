// Run the real texture loaders and real fallback asset route in isolation.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { build, transform } from 'esbuild';
import { parseByteRange } from '../backend/src/byteRange.mjs';

const source = readFileSync(new URL('../src/paintComposite.ts', import.meta.url), 'utf8');
const loaders = source.slice(source.indexOf('const texCache ='), source.indexOf('\nfunction fallbackTex('));
assert(loaders.includes('function loadTex(') && loaders.includes('function loadExr('));
const trace = { exr: [], image: [] };
globalThis.__paintInputTrace = trace;
const makeTexture = () => ({ image: { width: 2, height: 2, data: new Float32Array([-10, 0, 3, 1, 2, 4, 8, 1, 12, 16, 32, 1, -5, -1, 64, 1]) } });
const compiled = await build({
  // loadTex tries rawPng's exact decoder first (Safari) and falls back to the
  // browser's loader when it answers null, which is what Chrome always gets.
  stdin: { contents: 'const failedUrls = new Set<string>();\nconst loadRawPngTexture = async (_THREE: unknown, _url: string) => null;\n' + loaders + '\nexport {loadTex,loadExr,failedUrls};', loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'recording-exr-loader', setup(b) {
    b.onResolve({ filter: /^three\/examples\/jsm\/loaders\/EXRLoader\.js$/ }, () => ({ path: 'exr', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export class EXRLoader { async loadAsync(url) { globalThis.__paintInputTrace.exr.push(url); if(url.includes('missing')) throw Error('fixture failure'); return (${makeTexture.toString()})(); } }` }));
  } }],
});
const runtime = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const THREE = {
  TextureLoader: class { async loadAsync(url) { trace.image.push(url); return makeTexture(); } },
  NoColorSpace: 'linear-data', SRGBColorSpace: 'srgb', RepeatWrapping: 'repeat', MirroredRepeatWrapping: 'mirror', ClampToEdgeWrapping: 'clamp', LinearFilter: 'linear',
};
const input = await runtime.loadTex(THREE, 'https://assets.test/position.EXR?v=35#data', { srgb: false, wrap: false });
assert.equal(trace.exr.length, 1); assert.equal(trace.image.length, 0);
assert.deepEqual([...input.image.data], [12, 16, 32, 1, -5, -1, 64, 1, -10, 0, 3, 1, 2, 4, 8, 1]);
assert.equal(input.colorSpace, THREE.NoColorSpace); assert.equal(input.wrapS, 'clamp');
assert.equal(input.flipY, false); assert.equal(input.generateMipmaps, false);
assert.strictEqual(await runtime.loadExr(THREE, 'https://assets.test/position.EXR?v=35#data'), input);
assert.equal(trace.exr.length, 1, 'generic/default position inputs share a compatible cache entry');
console.log('ok generic EXR sampler preserves signed/range data and correct row order');
const wrap = await runtime.loadTex(THREE, 'https://assets.test/position.EXR?v=35#data', { srgb: false, wrap: true });
assert.notStrictEqual(wrap, input); assert.equal(wrap.wrapS, 'repeat'); assert.equal(input.wrapS, 'clamp');
const addr = await runtime.loadTex(THREE, 'https://assets.test/position.EXR?v=35#data', { srgb: false, wrap: true, addr: [1, 4] });
assert.equal(addr.wrapS, 'mirror'); assert.equal(addr.wrapT, 'clamp');
console.log('ok sampler addressing has separate texture/cache state');
const png = await runtime.loadTex(THREE, 'https://assets.test/color.webp?v=35', { srgb: true, wrap: true });
assert.equal(trace.image.length, 1); assert.equal(png.colorSpace, 'srgb'); assert.equal(png.wrapS, 'repeat');
assert.deepEqual([...png.image.data], [...makeTexture().image.data], 'ordinary image loader row behavior unchanged');
console.log('ok ordinary images retain their existing loader and color settings');
assert.equal(await runtime.loadTex(THREE, 'https://assets.test/missing.exr', { srgb: false, wrap: false }), null);
assert(runtime.failedUrls.has('https://assets.test/missing.exr'));
console.log('ok failed EXR input reaches the existing incomplete-composite signal');

const backend = readFileSync(new URL('../backend/src/main.ts', import.meta.url), 'utf8');
const types = backend.slice(backend.indexOf('const ASSET_TYPES:'), backend.indexOf('\n};', backend.indexOf('const ASSET_TYPES:')) + 3);
const route = backend.slice(backend.indexOf('function serveAssetDir('), backend.indexOf('\nserveAssetDir("/paints"'));
const typesJs = (await transform(types + '\nexport {ASSET_TYPES};', { loader: 'ts', format: 'esm' })).code;
const { ASSET_TYPES } = await import('data:text/javascript;base64,' + Buffer.from(typesJs).toString('base64'));
const routeJs = (await transform(route, { loader: 'ts', format: 'esm' })).code;
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const app = require('fastify')();
const root = mkdtempSync(path.join(os.tmpdir(), 'paint-exr-route-'));
try {
  const bytes = Buffer.from([0x76, 0x2f, 0x31, 0x01, 0, 1, 2, 3]);
  writeFileSync(path.join(root, 'position.exr'), bytes);
  const register = new Function('app', 'path', 'fs', 'createReadStream', 'parseByteRange', 'ASSET_TYPES', routeJs + '\nreturn serveAssetDir;')(app, path, fs, createReadStream, parseByteRange, ASSET_TYPES);
  register('/paints', root);
  const response = await app.inject({ url: '/paints/position.exr?v=35' });
  assert.equal(response.statusCode, 200); assert.deepEqual(response.rawPayload, bytes);
  assert.equal(response.headers['access-control-allow-origin'], '*');
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  const head = await app.inject({ method: 'HEAD', url: '/paints/position.exr?v=35' });
  assert.equal(head.statusCode, 200); assert.equal(head.rawPayload.length, 0);
  console.log('ok actual cross-node fallback serves EXR bytes and HEAD');
  const range = await app.inject({ url: '/paints/position.exr', headers: { range: 'bytes=0-3' } });
  assert.equal(range.statusCode, 206); assert.deepEqual(range.rawPayload, bytes.subarray(0, 4));
  assert.equal(range.headers['content-range'], 'bytes 0-3/8');
  console.log('ok EXR range responses preserve bytes');
  const missing = await app.inject({ url: '/paints/missing.exr?v=35' });
  assert.equal(missing.statusCode, 404); assert.equal(missing.headers['cache-control'], 'no-store');
  assert.equal((await app.inject({ url: '/paints/position.exe' })).statusCode, 404);
  console.log('ok missing EXRs and unsupported formats keep honest failures');
} finally { await app.close(); rmSync(root, { recursive: true, force: true }); delete globalThis.__paintInputTrace; }
console.log('all 7 real loader/asset route checks pass');
