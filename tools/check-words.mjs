import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname } from 'node:path';
import { runInNewContext, Script } from 'node:vm';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const sandbox = { window: {} };
runInNewContext(readFileSync(join(root, 'assets/js/words-core.js'), 'utf8'), sandbox);
const Core = sandbox.window.WordsCore;
const data = JSON.parse(readFileSync(join(root, 'assets/data/gre-words.json'), 'utf8'));
const words = Core.validateWords(data);
assert.equal(words.length, 300);
assert.equal(new Set(words.map(word => word.id)).size, 300);
assert.equal(Core.parseWordList('\uFEFFexample\tn. a sample\r\nother\tadj, different\r\n').length, 2);
assert.throws(() => Core.parseWordList('missing tab'));
assert.throws(() => Core.parseWordList('word\tn. one\nword\tn. two'));
assert.throws(() => Core.validateWords({version:1,words:[{word:'no id',definition:'example'}]}));
assert.equal(Core.normalizeAnswer('  ALCHEMY  '), 'alchemy');
assert.notEqual(Core.normalizeAnswer('a lchemy'), 'alchemy');
const positions = new Set();
for (const [index, word] of words.entries()) {
  const options = Core.choicesFor(word, words, Core.random(index + 1));
  assert.equal(options.length, 4, word.id);
  assert.equal(new Set(options.map(w => w.id)).size, 4);
  assert.equal(new Set(options.map(w => w.definition.toLowerCase())).size, 4);
  assert.equal(options.filter(w => w.id === word.id).length, 1);
  positions.add(options.findIndex(w => w.id === word.id));
}
assert.equal(positions.size, 4, 'answers must not always occupy the same position');
const artless = words.find(w => w.id === 'artless');
for (let i=0;i<20;i++) assert.ok(!Core.choicesFor(artless,words,Core.random(i)).some(w => w.id === 'guileless'));
const day = '2026-10-25';
const daily = Core.dailyWords(words, day);
assert.equal(daily.length, 10);
assert.equal(new Set(daily.map(w => w.id)).size, 10);
assert.equal(JSON.stringify(daily), JSON.stringify(Core.dailyWords(words, day)));
const firsts = new Set();
for (let i=0;i<300;i++) firsts.add(Core.dailyWords(words, Core.dateKey(new Date(2026,0,1+i)), 1)[0].id);
assert.equal(firsts.size, 300, 'daily word rotates through the entire deck');
assert.equal(Core.dateKey(new Date(2026,9,25,0,30)), day, 'use local calendar date');
let progress = Core.recordAnswer(Core.emptyProgress(), 'artless', 'choice', false, new Date(2026,9,25));
progress = Core.recordAnswer(progress, 'artless', 'spelling', true, new Date(2026,9,25));
assert.equal(Core.recordFor(progress,'artless','choice').needsReview,true);
assert.equal(Core.recordFor(progress,'artless','spelling').needsReview,false);
assert.equal(Object.keys(progress.days[day].ids).length,1);
assert.equal(progress.days[day].attempts,2);
assert.equal(Core.sessionWords(words,progress,'choice','mistakes').length,1);
assert.equal(Core.sessionWords(words,progress,'spelling','mistakes').length,0);
progress = Core.recordAnswer(progress,'artless','choice',true,new Date(2026,9,25));
assert.equal(Core.recordFor(progress,'artless','choice').needsReview,false);
assert.equal(Core.recordFor(progress,'artless','choice').attempts,2);
assert.equal(Core.recordFor(Core.emptyProgress(),'constructor','choice').attempts,0);
assert.equal(Core.readProgress({getItem:() => '{broken'}).version,1);
assert.equal(Core.saveProgress({setItem:() => {throw Error('blocked')}},progress),false);
assert.equal(Core.storageAvailable(null),false);
let history = Core.emptyProgress();
for(let i=0;i<100;i++) history = Core.recordAnswer(history,'artless','choice',true,new Date(2026,0,1+i));
assert.equal(Object.keys(history.days).length,90,'bound daily history size');
for (const file of ['assets/js/words-core.js','assets/js/words.js','assets/js/daily-word.js','assets/js/main.js']) new Script(readFileSync(join(root,file),'utf8'));
console.log('PASS 300 unique entries, all distractors, daily rotation, spelling normalization, separate mode records and storage failures');
if (!process.argv.includes('--browser')) process.exit(0);

const output = mkdtempSync('/tmp/words-check-');
let failWords = false;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/plain', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer((request,response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if (failWords && pathname === '/assets/data/gre-words.json') { response.writeHead(503); response.end(); return; }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const path = resolve(root,'.'+pathname);
    if (!path.startsWith(root) || pathname.split('/').some(p=>p.startsWith('.')) || !mime[extname(path)]) throw Error('Not found');
    const body = readFileSync(path);
    response.writeHead(200,{'Content-Type':mime[extname(path)],'Cache-Control':'no-store'});response.end(body);
  } catch {response.writeHead(404);response.end();}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-pipe',
  `--user-data-dir=${mkdtempSync('/tmp/words-chrome-')}`
],{stdio:['ignore','ignore','pipe','pipe','pipe']});
chrome.stderr.resume();
let nextId=0, buffer=Buffer.alloc(0);
const pending=new Map(), exceptions=[];
chrome.stdio[4].on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);let end;
  while((end=buffer.indexOf(0))>=0){
    const packet=JSON.parse(buffer.subarray(0,end).toString());buffer=buffer.subarray(end+1);
    if(pending.has(packet.id)){
      const {resolve,reject,timer}=pending.get(packet.id);clearTimeout(timer);pending.delete(packet.id);
      if(packet.error)reject(Error(JSON.stringify(packet.error)));else resolve(packet.result);
    }
    if(packet.method==='Runtime.exceptionThrown')exceptions.push(packet.params.exceptionDetails);
  }
});
const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout: '+method));},20000);
  pending.set(id,{resolve,reject,timer});
  chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
});
let session;
const evaluate=async expression=>{
  const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},session);
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;
};
const waitFor=async expression=>{
  const deadline=Date.now()+15000;
  do{if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,75));}while(Date.now()<deadline);
  throw Error('Condition timed out: '+expression);
};
const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
const navigate=async(path,ready)=>{await cdp('Page.navigate',{url:origin+path},session);await waitFor(ready);};
const ready=`document.getElementById('words-app')?.hidden === false`;
const readRecord=()=>evaluate(`JSON.parse(localStorage.getItem(WordsCore.STORAGE_KEY))`);
const setPool=pool=>evaluate(`{const s=document.getElementById('words-pool');s.value=${JSON.stringify(pool)};s.dispatchEvent(new Event('change'));}`);
const type=text=>evaluate(`{const s=document.getElementById('words-answer');s.value=${JSON.stringify(text)};s.dispatchEvent(new Event('input'));}`);
const checkWidth=async()=>{
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth + 2'),false,'horizontal overflow');
  assert.ok(await evaluate(`document.querySelector('.nav-drawer') && !document.querySelector('.nav-links').classList.contains('open') || document.querySelector('.nav-links').getBoundingClientRect().right <= innerWidth`),'clipped navigation');
};
const screenshot=async name=>{
  await evaluate(`(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));})()`);
  await evaluate(`document.documentElement.style.scrollBehavior='auto';scrollTo(0,0);document.activeElement.blur()`);
  const {data}=await cdp('Page.captureScreenshot',{format:'png'},session);writeFileSync(join(output,name+'.png'),Buffer.from(data,'base64'));
};
try{
  const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});
  ({sessionId:session}=await cdp('Target.attachToTarget',{targetId,flatten:true}));
  await cdp('Page.enable',{},session);await cdp('Runtime.enable',{},session);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false},session);
  await navigate('/',`Boolean(document.getElementById('daily-word-term')?.textContent)`);
  await evaluate(`localStorage.clear();localStorage.setItem('lang','zh')`);
  await navigate('/',`Boolean(document.getElementById('daily-word-term')?.textContent)`);
  const dailyTerm=await evaluate(`document.getElementById('daily-word-term').textContent`);
  const href=await evaluate(`document.getElementById('daily-word-link').getAttribute('href')`);
  assert.ok(href.includes('word='+dailyTerm));
  assert.ok(await evaluate(`Boolean(document.querySelector('#tools-grid a[href="words.html"]'))`));
  await screenshot('home-daily-word');
  await click('lang-toggle');
  assert.equal(await evaluate(`document.getElementById('daily-word-title').textContent`),'Word of the day');
  assert.equal(await evaluate(`document.getElementById('daily-word-term').textContent`),dailyTerm);
  await navigate('/'+href,ready);
  assert.equal(await evaluate(`document.getElementById('words-question-title').textContent`),dailyTerm);
  const optionsBefore=await evaluate(`Array.from(document.querySelectorAll('.words-option')).map(b=>b.textContent)`);
  await click('lang-toggle');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.words-option')).map(b=>b.textContent)`),optionsBefore,'language shuffled the question');
  assert.equal(await evaluate(`document.querySelectorAll('.words-option').length`),4);
  await screenshot('choices-desktop');
  await evaluate(`document.querySelector('.words-option[data-word-id="${dailyTerm}"]').click()`);
  await evaluate(`document.querySelector('.words-option[data-word-id="${dailyTerm}"]').click()`);
  assert.equal((await readRecord()).records[dailyTerm].choice.attempts,1,'double submission counted twice');
  assert.equal(await evaluate(`document.querySelectorAll('.words-option.is-correct').length`),1);
  await click('words-next');await click('words-skip');
  const wrongWord=await evaluate(`document.getElementById('words-question-title').textContent`);
  assert.equal((await readRecord()).records[wrongWord].choice.needsReview,true);
  await setPool('mistakes');
  assert.equal(await evaluate(`document.getElementById('words-question-title').textContent`),wrongWord);
  await evaluate(`document.querySelector('[data-mode="spelling"]').click()`);
  assert.equal(await evaluate(`document.getElementById('words-empty').hidden`),false,'mode records should be independent');
  await setPool('today');
  await type('wrong spelling');
  await click('lang-toggle');
  assert.equal(await evaluate(`document.getElementById('words-answer').value`),'wrong spelling','language cleared spelling draft');
  await screenshot('spelling-desktop');
  await evaluate(`document.getElementById('words-spell-form').requestSubmit()`);
  assert.equal((await readRecord()).records[dailyTerm].spelling.needsReview,true);
  await setPool('mistakes');
  await type('  '+dailyTerm.toUpperCase()+'  ');
  await evaluate(`document.getElementById('words-spell-form').requestSubmit()`);
  assert.equal((await readRecord()).records[dailyTerm].spelling.needsReview,false);
  await click('words-next');
  assert.equal(await evaluate(`document.getElementById('words-summary').hidden`),false);
  assert.equal(await evaluate(`document.getElementById('words-summary-title').textContent`),'1 / 1');
  await screenshot('round-summary');
  console.log('PASS home daily word, tool entry, deep links, bilingual modes, single grading, wrong-word review and spelling normalization');

  await navigate('/words.html?mode=choice&pool=mistakes',ready);
  assert.equal(await evaluate(`document.getElementById('words-question-title').textContent`),wrongWord,'progress did not survive navigation');
  await click('words-skip');await click('words-next');await click('words-review-round');
  assert.equal(await evaluate(`document.getElementById('words-question-title').textContent`),wrongWord);
  await click('words-library-link');
  assert.equal(await evaluate(`document.getElementById('word-library').open`),true);
  await evaluate(`{const s=document.getElementById('words-search');s.value='ephemeral';s.dispatchEvent(new Event('input'));}`);
  assert.equal(await evaluate(`document.querySelectorAll('#words-library-list li').length`),1);
  await evaluate(`document.querySelector('#words-library-list button').click()`);
  assert.equal(await evaluate(`document.getElementById('words-question-title').textContent`),'ephemeral');
  await evaluate(`{const s=document.getElementById('words-search');s.value='<img onerror=alert(1)>';s.dispatchEvent(new Event('input'));}`);
  assert.equal(await evaluate(`document.getElementById('words-search-empty').hidden`),false);
  console.log('PASS persisted progress, round mistake retry, word-list search and individual practice');

  for(const width of [390,320]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true},session);
    await navigate('/words.html',ready);await checkWidth();await screenshot('choices-mobile-'+width);
    await evaluate(`document.querySelector('[data-mode="spelling"]').click()`);await checkWidth();await screenshot('spelling-mobile-'+width);
    await click('lang-toggle');await checkWidth();
    await navigate('/',`Boolean(document.getElementById('daily-word-term')?.textContent)`);await checkWidth();await screenshot('home-mobile-'+width);
  }
  await navigate('/words.html',ready);
  await evaluate(`localStorage.removeItem(WordsCore.STORAGE_KEY)`);await click('words-restart');
  for(let i=0;i<10;i++){
    if(i%2===0)await evaluate(`{const id=document.getElementById('words-question-title').textContent;Array.from(document.querySelectorAll('.words-option')).find(b=>b.dataset.wordId===id).click();}`);
    else await click('words-skip');
    await click('words-next');
  }
  assert.equal(await evaluate(`document.getElementById('words-summary-title').textContent`),'5 / 10');
  await click('words-review-round');
  assert.equal(await evaluate(`document.getElementById('words-question-count').textContent`),'1 / 5');
  console.log('PASS complete ten-word round, exact score and targeted retry');
  failWords=true;
  await navigate('/words.html',`document.getElementById('words-retry')?.hidden === false`);
  failWords=false;await click('words-retry');await waitFor(ready);
  failWords=true;
  await navigate('/',`document.getElementById('daily-word-retry')?.hidden === false`);
  failWords=false;await click('daily-word-retry');await waitFor(`Boolean(document.getElementById('daily-word-term').textContent)`);
  await evaluate(`localStorage.setItem('fizgrad.gre-progress.v1','{broken')`);
  await navigate('/words.html',ready);
  assert.equal(await evaluate(`document.getElementById('words-seen-count').textContent`),'0');
  const {identifier}=await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(window,'localStorage',{get(){throw Error('Blocked storage')}})`},session);
  await navigate('/words.html',ready);
  assert.equal(await evaluate(`document.getElementById('words-storage-note').classList.contains('is-warning')`),true);
  await click('words-skip');await click('words-next');await click('words-skip');
  assert.equal(await evaluate(`document.getElementById('words-seen-count').textContent`),'2','memory-only progress lost');
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier},session);
  assert.deepEqual(exceptions,[],'browser exceptions');
  console.log(`PASS 390/320px layouts, fetch retry, corrupt/blocked storage and memory-only practice; screenshots: ${output}`);
}finally{
  try{await cdp('Browser.close');}catch{}
  if(chrome.exitCode===null)chrome.kill('SIGTERM');
  await new Promise(resolve=>server.close(resolve));
}
