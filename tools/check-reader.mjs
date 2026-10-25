import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(join(root, 'reader.html'), 'utf8');
for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new Script(script);
console.log('PASS reader JavaScript syntax');
if (!process.argv.includes('--browser')) process.exit(0);

const offline = process.argv.includes('--offline');
const output = mkdtempSync('/tmp/reader-check-');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + pathname);
    if (!path.startsWith(root) || pathname.split('/').some(part => part.startsWith('.')) || !mime[extname(path)]) throw new Error('Not found');
    const body = readFileSync(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)], 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-pipe',
  `--user-data-dir=${mkdtempSync('/tmp/reader-chrome-')}`
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let nextId = 0;
let buffer = Buffer.alloc(0);
const pending = new Map();
const exceptions = [];
chrome.stderr.resume();
chrome.stdio[4].on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  let end;
  while ((end = buffer.indexOf(0)) >= 0) {
    const packet = JSON.parse(buffer.subarray(0, end).toString());
    buffer = buffer.subarray(end + 1);
    if (pending.has(packet.id)) {
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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timeout: ' + method)); }, 20000);
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
  const deadline = Date.now() + 30000;
  do {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('Condition timed out: ' + expression);
};
const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
const setText = text => evaluate(`{ const editor = document.getElementById('reader-textarea'); editor.value = ${JSON.stringify(text)}; editor.dispatchEvent(new Event('input', {bubbles:true})); }`);
const drop = files => evaluate(`{
  const data = new DataTransfer();
  for (const file of ${JSON.stringify(files)}) data.items.add(new File([file.text], file.name, {type:'text/plain'}));
  document.getElementById('reader-dropzone').dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:data}));
}`);
const checkWidth = async () => {
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth + 2'), false, 'horizontal page overflow');
  assert.ok(await evaluate(`document.querySelector('.nav-links').getBoundingClientRect().right <= innerWidth`), 'navigation clipped');
};
const screenshot = async name => {
  await evaluate('document.activeElement.blur(); document.documentElement.style.scrollBehavior="auto"; scrollTo(0,0)');
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  writeFileSync(join(output, name + '.png'), Buffer.from(data, 'base64'));
};
try {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp('Target.attachToTarget', { targetId, flatten: true }));
  await cdp('Page.enable', {}, session);
  await cdp('Runtime.enable', {}, session);
  await cdp('Network.enable', {}, session);
  if (offline) await cdp('Network.setBlockedURLs', { urls: ['*cdn.jsdelivr.net*', '*cdnjs.cloudflare.com*'] }, session);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('lang','zh');" }, session);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, session);
  await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/reader.html` }, session);
  await waitFor(`document.getElementById('reader-count')?.textContent.includes('字符')`);
  assert.equal(await evaluate(`document.getElementById('reader-render-btn').disabled`), true);
  assert.equal(await evaluate(`document.getElementById('reader-view').hidden`), true);
  await evaluate(`window.__pickerClicks=0; document.getElementById('reader-file-input').addEventListener('click', e => { e.preventDefault(); window.__pickerClicks++; });`);
  for (const id of ['reader-dropzone', 'reader-title', 'reader-textarea']) await click(id);
  assert.equal(await evaluate('window.__pickerClicks'), 0, 'unrelated UI opened the picker');
  await click('reader-open-file');
  assert.equal(await evaluate('window.__pickerClicks'), 1);
  await checkWidth();
  await screenshot('reader-desktop');
  await click('lang-toggle');
  assert.equal(await evaluate(`document.getElementById('reader-title').textContent`), 'Markdown Reader');
  assert.ok(await evaluate(`document.getElementById('reader-textarea').placeholder.startsWith('# Document')`));
  await screenshot('reader-desktop-en');
  await setText('   \n');
  assert.equal(await evaluate(`document.getElementById('reader-render-btn').disabled`), true);
  await setText('😀\nC++');
  assert.equal(await evaluate(`document.getElementById('reader-count').textContent`), '2 lines · 5 characters');
  await evaluate('window.confirm = () => false');
  await click('reader-example');
  assert.equal(await evaluate(`document.getElementById('reader-textarea').value`), '😀\nC++');
  await evaluate('window.confirm = () => true');
  await click('reader-clear');
  await click('reader-example');
  const example = await evaluate(`document.getElementById('reader-textarea').value`);
  assert.ok(example.includes('```mermaid'));
  assert.ok(example.includes('$$E = mc^2$$'));
  await evaluate(`document.getElementById('reader-textarea').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))`);
  await waitFor(`!document.getElementById('reader-view').hidden`);
  if (!offline) {
    await waitFor(`document.querySelector('#post-content .mermaid svg') && document.querySelector('#post-content mjx-container')`);
    assert.equal(await evaluate(`document.querySelectorAll('#toc-nav a').length`), 3);
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText: async text => {window.__copied=text}}}); document.querySelector('#post-content .copy-btn').click();`);
    await waitFor(`window.__copied === ${JSON.stringify('int answer = 42;\n')}`);
    await evaluate(`document.querySelector('.mermaid-fullscreen-btn').click()`);
    assert.equal(await evaluate(`document.body.classList.contains('mermaid-page-fullscreen-open')`), true);
    await evaluate(`document.querySelector('.is-mermaid-page-fullscreen .mermaid-fullscreen-btn').click()`);
    assert.equal(await evaluate(`document.body.classList.contains('mermaid-page-fullscreen-open')`), false);
  } else {
    assert.equal(await evaluate(`document.querySelector('#post-content pre').textContent`), example);
  }
  await click('reader-edit');
  assert.equal(await evaluate(`document.getElementById('reader-textarea').value`), example, 'return to editor lost the draft');
  await click('lang-toggle');
  assert.equal(await evaluate(`document.getElementById('reader-textarea').value`), example, 'language switch changed the source');
  console.log('PASS bilingual editor, disabled states, picker isolation, replacement confirmation, preview/edit and shortcut');

  await click('reader-clear');
  await drop([{name:'bad.pdf',text:'not markdown'}]);
  assert.ok(await evaluate(`document.getElementById('reader-status').textContent.includes('.md')`));
  await drop([{name:'a.md',text:'# A'}, {name:'b.md',text:'# B'}]);
  assert.ok(await evaluate(`document.getElementById('reader-status').textContent.includes('一个文件')`));
  await drop([{name:'empty.md',text:''}]);
  await waitFor(`document.getElementById('reader-filename').textContent === 'empty.md'`);
  assert.equal(await evaluate(`document.getElementById('reader-view').hidden`), true);
  const fileText = '# Local document\n\n## Details\n\nHello';
  await drop([{name:'Local.MD',text:fileText}]);
  await waitFor(`!document.getElementById('reader-view').hidden`);
  await click('reader-edit');
  assert.equal(await evaluate(`document.getElementById('reader-filename').textContent`), 'Local.MD');
  assert.equal(await evaluate(`document.getElementById('reader-textarea').value`), fileText);
  await setText('# XSS\n<img src="missing" onerror="window.__readerXss=true">\n<script>window.__readerXss=true</script>');
  await click('reader-render-btn');
  if (!offline) {
    assert.equal(await evaluate(`Boolean(window.__readerXss)`), false);
    assert.equal(await evaluate(`document.querySelectorAll('#post-content [onerror], #post-content script').length`), 0);
  }
  await evaluate('window.confirm = () => false');
  await click('reader-new');
  assert.equal(await evaluate(`document.getElementById('reader-view').hidden`), false);
  await evaluate('window.confirm = () => true');
  await click('reader-new');
  assert.equal(await evaluate(`document.getElementById('reader-textarea').value`), '');
  console.log('PASS file drops, empty/invalid/multiple files, draft preservation, XSS sanitization and new document');

  const fixture = join(output, 'chosen.md');
  writeFileSync(fixture, '# Chosen file\n\nOpened with the file input.');
  const { root: dom } = await cdp('DOM.getDocument', {}, session);
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: dom.nodeId, selector: '#reader-file-input' }, session);
  for (let i=0;i<2;i++) {
    await click('reader-open-file');
    await cdp('DOM.setFileInputFiles', { nodeId, files: [fixture] }, session);
    await waitFor(`!document.getElementById('reader-view').hidden`);
    assert.equal(await evaluate(`document.getElementById('reader-filename').textContent`), 'chosen.md');
    await click('reader-edit');
    await click('reader-clear');
  }
  await evaluate(`{
    window.__nativeFileReader = window.FileReader;
    window.FileReader = class {
      constructor() { window.__pendingFileRead = this; }
      readAsText() {}
      abort() { this.aborted = true; }
    };
  }`);
  await drop([{name:'delayed.md',text:'# Delayed'}]);
  assert.equal(await evaluate(`document.getElementById('reader-render-btn').disabled`), true);
  await setText('new typing');
  assert.equal(await evaluate('window.__pendingFileRead.aborted'), true);
  await evaluate(`window.__pendingFileRead.onload({target:{result:'# Stale file'}})`);
  assert.equal(await evaluate(`document.getElementById('reader-textarea').value`), 'new typing');
  await click('reader-clear');
  await drop([{name:'unreadable.md',text:'unreadable'}]);
  await evaluate(`window.__pendingFileRead.onerror()`);
  assert.ok(await evaluate(`document.getElementById('reader-status').textContent.includes('读取失败')`));
  await evaluate('window.FileReader = window.__nativeFileReader');
  await click('reader-example');
  await click('reader-clear');
  console.log('PASS native file input and same-file reopening, read failures and stale read cancellation');

  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }, session);
    await checkWidth();
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.reader-workspace')).gridTemplateColumns.split(' ').length`), 1);
    await screenshot('reader-mobile-' + width);
    await click('lang-toggle');
    await checkWidth();
    await screenshot('reader-mobile-' + width + '-en');
    await click('reader-example');
    await click('reader-render-btn');
    await checkWidth();
    const navItems = await evaluate(`Array.from(document.querySelectorAll('.nav-links > *')).map(e => ({x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right}))`);
    for (let i=1;i<navItems.length;i++) assert.ok(navItems[i].x >= navItems[i-1].right, 'overlapping mobile navigation');
    await click('reader-edit');
    await click('reader-clear');
    await click('lang-toggle');
  }
  assert.deepEqual(exceptions, [], 'browser exceptions');
  console.log(`PASS 390/320px mobile input and preview navigation; ${offline ? 'offline fallback' : 'math, Mermaid and code copy'}; screenshots: ${output}`);
} finally {
  try { await cdp('Browser.close'); } catch {}
  if (chrome.exitCode === null) chrome.kill('SIGTERM');
  await new Promise(resolve => server.close(resolve));
}
