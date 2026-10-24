import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname } from 'node:path';
import { Script, createContext } from 'node:vm';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(join(root, 'assets/js/blog-catalog.js'), 'utf8');
const context = createContext({ window: {}, URLSearchParams, navigator: { language: 'zh-CN' }, localStorage: { getItem: () => null } });
new Script(source).runInContext(context);
const catalog = context.window.BlogCatalog;
const posts = JSON.parse(readFileSync(join(root, 'blog/posts.json'), 'utf8'));
const groups = catalog.groups(posts);
const gpuCount = groups.find(g => g.category.id === 'gpu').posts.length;
assert.equal(new Set(posts.map(p => p.slug)).size, posts.length);
assert.equal(groups.reduce((sum, g) => sum + g.posts.length, 0), posts.length);
assert.equal(new Set(groups.flatMap(g => g.posts.map(p => p.slug))).size, posts.length);
for (const post of posts) {
  assert.ok(catalog.category(post.category), `${post.slug}: unknown category`);
  assert.ok(!['all', 'other'].includes(post.category), `${post.slug}: missing explicit topic`);
  assert.ok(existsSync(join(root, 'blog', post.slug + '.md')), `${post.slug}: missing article`);
}
assert.equal(catalog.groups([{ slug: 'new' }, { slug: 'future', category: 'unknown' }])[0].posts.length, 2);
assert.equal(catalog.categoryFor({ category: 'all' }).id, 'other');
for (const query of ['?page=-1', '?page=NaN', '?page=1000000', '?category=unknown']) {
  assert.equal(catalog.readState(query).page, 1);
}
assert.equal(catalog.readState('?blogPage=2&blogSearch=CUDA').page, 2);
const state = { category: 'gpu', page: 2, query: 'CUDA & <script>' };
const parsed = catalog.readState(new URL(catalog.listURL(state), 'https://example.test/blog/').search);
assert.equal(JSON.stringify(parsed), JSON.stringify(state));
for (const path of ['assets/js/blog-catalog.js', 'assets/js/blog-list.js', 'assets/js/main.js']) {
  new Script(readFileSync(join(root, path), 'utf8'), { filename: path });
}
for (const match of readFileSync(join(root, 'blog/post.html'), 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  new Script(match[1]);
}
console.log(`PASS: ${posts.length} articles in ${groups.length} topics; no missing/duplicate articles, URL state and JavaScript syntax`);
if (!process.argv.includes('--browser')) process.exit(0);

const output = mkdtempSync('/tmp/blog-catalog-check-');
let fixture = null;
let failPosts = false;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/plain', '.png': 'image/png' };
const server = createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400); response.end(); return; }
  if (pathname === '/blog/posts.json') {
    response.writeHead(failPosts ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(fixture || posts));
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const path = resolve(root, '.' + pathname);
  if (!path.startsWith(root) || pathname.split('/').some(p => p.startsWith('.')) || !mime[extname(path)]) {
    response.writeHead(404); response.end(); return;
  }
  try {
    const body = readFileSync(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] + '; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-pipe',
  `--user-data-dir=${mkdtempSync('/tmp/blog-catalog-chrome-')}`
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let nextId = 0;
let buffer = Buffer.alloc(0);
const pending = new Map();
const exceptions = [];
let chromeLog = '';
chrome.stderr.on('data', chunk => { chromeLog = (chromeLog + chunk).slice(-2000); });
chrome.stdio[4].on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  let end;
  while ((end = buffer.indexOf(0)) >= 0) {
    const packet = JSON.parse(buffer.subarray(0, end).toString());
    buffer = buffer.subarray(end + 1);
    if (packet.id && pending.has(packet.id)) {
      const { resolve, reject, timer } = pending.get(packet.id);
      clearTimeout(timer); pending.delete(packet.id);
      if (packet.error) reject(new Error(JSON.stringify(packet.error)));
      else resolve(packet.result);
    }
    if (packet.method === 'Runtime.exceptionThrown') exceptions.push(packet.params.exceptionDetails);
  }
});
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out\n${chromeLog}`)); }, 20000);
  pending.set(id, { resolve, reject, timer });
  chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
let session;
const evaluate = async expression => {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const waitFor = async expression => {
  const deadline = Date.now() + 15000;
  do {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 75));
  } while (Date.now() < deadline);
  throw new Error(`Condition timed out: ${expression}`);
};
const navigate = async (path, ready) => {
  await cdp('Page.navigate', { url: origin + path }, session);
  await waitFor(ready);
};
const listReady = `document.querySelector('#blog-list')?.getAttribute('aria-busy') === 'false'`;
const checkWidth = async () => assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth + 2'), false, 'horizontal overflow');
const screenshot = async name => {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  writeFileSync(join(output, name + '.png'), Buffer.from(data, 'base64'));
};
try {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp('Target.attachToTarget', { targetId, flatten: true }));
  await cdp('Page.enable', {}, session);
  await cdp('Runtime.enable', {}, session);
  await cdp('Network.enable', {}, session);
  // Navigation tests are offline: article renderers keep their existing text fallback.
  await cdp('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*cdn.jsdelivr.net*', '*cdnjs.cloudflare.com*'] }, session);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "if (!localStorage.getItem('lang')) localStorage.setItem('lang', 'zh');" }, session);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, session);

  await navigate('/#blog', `document.querySelectorAll('.blog-folder').length === ${groups.length}`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.blog-folder-count')).reduce((n, e) => n + parseInt(e.textContent), 0)`), posts.length);
  await checkWidth();
  await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('blog').scrollIntoView(); window.scrollBy(0, -90);`);
  await new Promise(resolve => setTimeout(resolve, 700));
  await screenshot('topics-desktop');
  await evaluate(`document.getElementById('lang-toggle').click()`);
  assert.equal(await evaluate(`document.querySelector('.blog-folder h3').textContent`), 'Languages & Algorithms');
  await evaluate(`document.getElementById('lang-toggle').click(); document.querySelector('.blog-folder[href*="category=gpu"]').click()`);
  await waitFor(`${listReady} && document.querySelectorAll('.blog-article').length === ${gpuCount}`);
  assert.equal(await evaluate(`document.getElementById('blog-category-title').textContent`), 'GPU 与 CUDA');
  assert.equal(await evaluate(`document.getElementById('blog-pagination').hidden`), true);
  await checkWidth();
  await screenshot('gpu-list-desktop');
  await evaluate(`document.querySelector('.blog-article-link').click()`);
  await waitFor(`document.getElementById('post-breadcrumb')?.hidden === false`);
  assert.equal(await evaluate(`new URL(document.getElementById('post-back-list').href).searchParams.get('category')`), 'gpu');
  await evaluate(`document.getElementById('post-category-link').click()`);
  await waitFor(`${listReady} && location.pathname === '/blog/index.html'`);
  console.log('PASS: home folders → topic list → article → topic list, bilingual topic cards');

  await navigate('/blog/index.html?page=2&q=a', listReady);
  assert.equal(await evaluate(`document.querySelector('[aria-current="page"][data-blog-page]').dataset.blogPage`), '2');
  await evaluate(`document.querySelector('.blog-article-link').click()`);
  await waitFor(`document.getElementById('post-breadcrumb')?.hidden === false`);
  assert.equal(await evaluate(`new URL(document.getElementById('post-back-list').href).searchParams.get('q')`), 'a');
  await evaluate(`document.getElementById('post-back-list').click()`);
  await waitFor(`${listReady} && location.pathname === '/blog/index.html'`);
  assert.equal(await evaluate(`new URL(location.href).searchParams.get('page')`), '2');
  await evaluate(`document.getElementById('lang-toggle').click()`);
  assert.equal(await evaluate(`document.getElementById('blog-category-title').textContent`), 'All Articles');
  assert.equal(await evaluate(`document.querySelector('[aria-current="page"][data-blog-page]').dataset.blogPage`), '2');
  await evaluate(`{ const s = document.getElementById('blog-search'); s.value = 'CUDA '; s.dispatchEvent(new Event('input')); }`);
  assert.equal(await evaluate(`document.getElementById('blog-search').value`), 'CUDA ');
  await evaluate(`{ const s = document.getElementById('blog-search'); s.value += 'memory'; s.dispatchEvent(new Event('input')); }`);
  assert.ok(await evaluate(`document.querySelectorAll('.blog-article').length > 0`));
  await evaluate(`{ const s = document.getElementById('blog-search'); s.value = 'no-match-xyz'; s.dispatchEvent(new Event('input')); }`);
  assert.equal(await evaluate(`document.getElementById('blog-empty').hidden`), false);
  assert.equal(await evaluate(`document.getElementById('blog-pagination').hidden`), true);
  console.log('PASS: list context restored from articles, language switch preserves state, multi-word search and empty results');

  await navigate('/blog/index.html', listReady);
  await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 240);`);
  const before = await evaluate('scrollY');
  await evaluate(`document.getElementById('blog-next').click()`);
  assert.equal(await evaluate('scrollY'), before, 'pagination moved viewport');
  await evaluate('history.back()');
  await waitFor(`!new URL(location.href).searchParams.has('page')`);
  assert.equal(await evaluate(`document.querySelector('[aria-current="page"][data-blog-page]').dataset.blogPage`), '1');
  await evaluate('history.forward()');
  await waitFor(`new URL(location.href).searchParams.get('page') === '2'`);
  await cdp('Page.reload', {}, session);
  await waitFor(`${listReady} && document.querySelector('[aria-current="page"][data-blog-page]')?.dataset.blogPage === '2'`);
  console.log('PASS: pagination does not scroll; back, forward and refresh restore page state');

  await evaluate(`{ const s = document.getElementById('blog-category'); s.value = 'android'; s.dispatchEvent(new Event('change')); }`);
  assert.equal(await evaluate(`new URL(location.href).searchParams.get('category')`), 'android');
  assert.equal(await evaluate(`document.querySelectorAll('.blog-article').length`), groups.find(g => g.category.id === 'android').posts.length);
  assert.equal(await evaluate(`document.getElementById('blog-pagination').hidden`), true);
  await navigate('/blog/post.html?slug=cuda_programming', `document.getElementById('post-breadcrumb')?.hidden === false`);
  assert.equal(await evaluate(`new URL(document.getElementById('post-category-link').href).searchParams.get('category')`), 'gpu');
  await navigate('/blog/post.html?slug=cuda_programming&category=backend&page=2', `document.getElementById('post-breadcrumb')?.hidden === false`);
  assert.equal(await evaluate(`new URL(document.getElementById('post-category-link').href).searchParams.get('category')`), 'gpu');
  console.log('PASS: category selector, existing direct article URLs, and mismatched navigation context');

  await navigate('/?blogPage=2#blog', `${listReady} && location.pathname === '/blog/index.html'`);
  assert.equal(await evaluate(`new URL(location.href).searchParams.get('page')`), '2');
  await navigate('/blog/index.html?category=bogus&page=-9', listReady);
  assert.equal(await evaluate(`document.getElementById('blog-category').value`), 'all');
  failPosts = true;
  await navigate('/blog/index.html?category=gpu', `document.getElementById('blog-retry')?.hidden === false`);
  failPosts = false;
  await evaluate(`document.getElementById('blog-retry').click()`);
  await waitFor(`${listReady} && document.querySelectorAll('.blog-article').length === ${gpuCount}`);

  fixture = posts.concat([{ slug: 'new-uncategorized', title: '新文章', titleEn: 'New article', category: 'future-topic' }]);
  await navigate('/#blog', `document.querySelectorAll('.blog-folder').length === ${groups.length + 1}`);
  await evaluate(`document.querySelector('.blog-folder[href*="category=other"]').click()`);
  await waitFor(`${listReady} && document.querySelectorAll('.blog-article').length === 1`);
  assert.match(await evaluate(`document.getElementById('blog-list').textContent`), /New article/);
  fixture = null;
  console.log('PASS: legacy links, invalid URL parameters, retry after failure, and fallback topic for future articles');

  fixture = Array.from({ length: 74 }, (_, i) => ({ slug: `fixture-${i}`, title: `Article ${i}`, category: 'gpu' }));
  await navigate('/blog/index.html?page=8', listReady);
  const pageButtons = await evaluate(`Array.from(document.querySelectorAll('[data-blog-page]')).map(b => Number(b.dataset.blogPage))`);
  assert.equal(pageButtons[0], 1);
  assert.equal(pageButtons.at(-1), 9);
  assert.equal(new Set(pageButtons).size, pageButtons.length);
  await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 250);`);
  const partialBefore = await evaluate('scrollY');
  await evaluate(`document.getElementById('blog-next').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.blog-article').length`), 2);
  assert.equal(await evaluate('scrollY'), partialBefore, 'short last page moved viewport');
  fixture = null;
  console.log('PASS: condensed page controls and viewport preservation on a short final page');

  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }, session);
    await navigate('/#blog', `document.querySelectorAll('.blog-folder').length === ${groups.length}`);
    await checkWidth();
    await evaluate(`document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('blog').scrollIntoView(); window.scrollBy(0, -85);`);
    if (width === 390) await screenshot('topics-mobile');
    await navigate('/blog/index.html?category=compilers', listReady);
    await checkWidth();
    if (width === 390) await screenshot('compiler-list-mobile');
    await evaluate(`document.getElementById('lang-toggle').click()`);
    await checkWidth();
  }
  assert.deepEqual(exceptions, [], 'uncaught browser exceptions');
  console.log(`PASS: desktop and 390/320px mobile layouts; screenshots: ${output}`);
} finally {
  try { await cdp('Browser.close'); } catch {}
  if (chrome.exitCode === null) chrome.kill('SIGTERM');
  await new Promise(resolve => server.close(resolve));
}
