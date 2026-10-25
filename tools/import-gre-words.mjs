import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2];
if (!source) throw new Error('Usage: node tools/import-gre-words.mjs /path/to/GRE_Words.txt');
const sandbox = { window: {} };
runInNewContext(readFileSync(join(root, 'assets/js/words-core.js'), 'utf8'), sandbox);
const words = sandbox.window.WordsCore.parseWordList(readFileSync(source, 'utf8'));
if (!words.length) throw new Error('The word list is empty');
mkdirSync(join(root, 'assets/data'), { recursive: true });
writeFileSync(join(root, 'assets/data/gre-words.json'), JSON.stringify({ version: 1, source: 'GRE_Words.txt', words }, null, 2) + '\n');
console.log(`Imported ${words.length} unique words; original words and definitions preserved.`);
