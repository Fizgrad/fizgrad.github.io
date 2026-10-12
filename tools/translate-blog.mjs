#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const BLOG_DIR = path.join(ROOT_DIR, "blog");
const CACHE_DIR = path.join(SCRIPT_DIR, ".translation-cache");
const POSTS_PATH = path.join(BLOG_DIR, "posts.json");

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_MAX_CHARS = 12000;

function usage() {
  console.log(`Usage:
  DEEPSEEK_API_KEY=... node tools/translate-blog.mjs [options]

Options:
  --slug <slug>       Translate one post; may be repeated
  --force             Regenerate existing .en.md files
  --check             Validate that every post has a structurally valid English file
  --dry-run           List work without calling the API or writing files
  --max-chars <n>     Approximate maximum characters per request (default: ${DEFAULT_MAX_CHARS})
  --help              Show this help

Optional environment variables:
  DEEPSEEK_API_KEY_FILE  Read the key from a local file instead of the environment
  DEEPSEEK_BASE_URL   OpenAI-compatible base URL (default: ${DEFAULT_BASE_URL})
  DEEPSEEK_MODEL      Translation model (default: ${DEFAULT_MODEL})

English Markdown is written to blog/<slug>.en.md. Resumable state is kept in
tools/.translation-cache/, which is excluded from Git.`);
}

function parseArgs(argv) {
  const options = {
    slugs: [],
    force: false,
    check: false,
    dryRun: false,
    maxChars: DEFAULT_MAX_CHARS
  };

  for (let index = 0; index < argv.length; ++index) {
    const arg = argv[index];
    if (arg === "--slug") {
      const slug = argv[++index];
      if (!slug) throw new Error("--slug requires a value");
      options.slugs.push(slug);
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--max-chars") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 2000 || value > 40000) {
        throw new Error("--max-chars must be an integer between 2000 and 40000");
      }
      options.maxChars = value;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function loadPosts() {
  const posts = JSON.parse(fs.readFileSync(POSTS_PATH, "utf8"));
  if (!Array.isArray(posts)) throw new Error("blog/posts.json must contain an array");
  return posts;
}

function selectedPosts(posts, slugs) {
  if (slugs.length === 0) return posts;
  const wanted = new Set(slugs);
  const selected = posts.filter((post) => wanted.has(post.slug));
  const found = new Set(selected.map((post) => post.slug));
  const missing = [...wanted].filter((slug) => !found.has(slug));
  if (missing.length) throw new Error(`Unknown post slug(s): ${missing.join(", ")}`);
  return selected;
}

function sourcePath(slug) {
  return path.join(BLOG_DIR, `${slug}.md`);
}

function englishPath(slug) {
  return path.join(BLOG_DIR, `${slug}.en.md`);
}

function extractFences(markdown) {
  const lines = markdown.split("\n");
  const fences = [];
  let current = null;

  for (const line of lines) {
    const opening = /^(\s*)(`{3,}|~{3,})([^`]*)$/.exec(line);
    if (!current && opening) {
      current = {
        marker: opening[2][0],
        width: opening[2].length,
        language: opening[3].trim().split(/\s+/)[0].toLowerCase(),
        lines: [line]
      };
      continue;
    }
    if (current) {
      current.lines.push(line);
      const closing = new RegExp(`^\\s*${current.marker}{${current.width},}\\s*$`);
      if (closing.test(line)) {
        fences.push({ language: current.language, text: current.lines.join("\n") });
        current = null;
      }
    }
  }
  if (current) throw new Error("Unclosed fenced code block");
  return fences;
}

function extractLinkTargets(markdown) {
  const targets = [];
  for (const match of markdown.matchAll(/\]\(([^)\n]+)\)/g)) targets.push(match[1]);
  for (const match of markdown.matchAll(/^\[[^\]]+\]:\s+(\S.*)$/gm)) targets.push(match[1]);
  return targets;
}

function headingLevels(markdown) {
  return [...markdown.matchAll(/^(#{1,6})\s+\S.*$/gm)].map((match) => match[1].length);
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validatePair(source, translated, slug) {
  const errors = [];
  if (!translated.trim()) errors.push("English file is empty");
  if (source === translated) errors.push("English file is identical to the Chinese source");
  if (/@@P\d{6}@@/.test(translated)) errors.push("unresolved protected placeholder");

  const sourceFences = extractFences(source);
  const translatedFences = extractFences(translated);
  if (sourceFences.length !== translatedFences.length) {
    errors.push(`fenced block count changed (${sourceFences.length} -> ${translatedFences.length})`);
  } else {
    for (let index = 0; index < sourceFences.length; ++index) {
      const before = sourceFences[index];
      const after = translatedFences[index];
      if (before.language !== after.language) {
        errors.push(`fence ${index + 1} language changed (${before.language} -> ${after.language})`);
      }
      if (!["mermaid", "text"].includes(before.language) && before.text !== after.text) {
        errors.push(`executable code block ${index + 1} changed`);
      }
    }
  }

  const sourceHeadings = headingLevels(source);
  const translatedHeadings = headingLevels(translated);
  if (!sameArray(sourceHeadings, translatedHeadings)) errors.push("heading structure changed");

  const sourceTargets = extractLinkTargets(source);
  const translatedTargets = extractLinkTargets(translated);
  if (!sameArray(sourceTargets, translatedTargets)) errors.push("link targets changed");

  if (errors.length) throw new Error(`${slug}: ${errors.join("; ")}`);
}

function createProtector() {
  const values = [];
  function protect(value) {
    const token = `@@P${String(values.length).padStart(6, "0")}@@`;
    values.push(value);
    return token;
  }
  return { values, protect };
}

function protectMarkdown(markdown) {
  const protector = createProtector();
  const lines = markdown.split("\n");
  const firstPass = [];

  for (let index = 0; index < lines.length;) {
    const opening = /^(\s*)(`{3,}|~{3,})([^`]*)$/.exec(lines[index]);
    if (!opening) {
      firstPass.push(lines[index++]);
      continue;
    }

    const marker = opening[2][0];
    const width = opening[2].length;
    const language = opening[3].trim().split(/\s+/)[0].toLowerCase();
    const block = [lines[index++]];
    const closing = new RegExp(`^\\s*${marker}{${width},}\\s*$`);
    while (index < lines.length) {
      const line = lines[index++];
      block.push(line);
      if (closing.test(line)) break;
    }
    if (!closing.test(block.at(-1))) throw new Error("Unclosed fenced code block");

    if (language === "mermaid" || language === "text") firstPass.push(block.join("\n"));
    else firstPass.push(protector.protect(block.join("\n")));
  }

  let text = firstPass.join("\n");

  const patterns = [
    /\$\$[\s\S]*?\$\$/g,
    /\\\[[\s\S]*?\\\]/g,
    /\\\([\s\S]*?\\\)/g,
    /(`+)([^\n]*?)\1/g,
    /<\/?[A-Za-z][^>]*>/g
  ];
  for (const pattern of patterns) text = text.replace(pattern, (value) => protector.protect(value));

  text = text.replace(/(^|[^\\$])\$(?!\$)([^$\n]+?)\$/g,
    (_whole, prefix, body) => `${prefix}${protector.protect(`$${body}$`)}`);

  text = text.replace(/\]\(([^)\n]+)\)/g, (_whole, target) => `](${protector.protect(target)})`);
  text = text.replace(/^(\[[^\]]+\]:\s+)(\S.*)$/gm,
    (_whole, prefix, target) => `${prefix}${protector.protect(target)}`);
  text = text.replace(/https?:\/\/[^\s)>]+/g, (url) => protector.protect(url));

  return { text, protectedValues: protector.values };
}

function restoreProtected(text, values) {
  let restored = text;
  for (let index = 0; index < values.length; ++index) {
    const token = `@@P${String(index).padStart(6, "0")}@@`;
    const count = restored.split(token).length - 1;
    if (count !== 1) throw new Error(`placeholder ${token} occurs ${count} times`);
    restored = restored.replace(token, values[index]);
  }
  return restored;
}

function splitUnits(markdown) {
  const lines = markdown.split("\n");
  const units = [];
  let prose = [];

  function flushProse() {
    if (!prose.length) return;
    const text = prose.join("\n");
    for (const part of text.split(/\n{2,}/)) {
      if (part.length) units.push(part);
    }
    prose = [];
  }

  for (let index = 0; index < lines.length;) {
    const opening = /^(\s*)(`{3,}|~{3,})([^`]*)$/.exec(lines[index]);
    if (!opening) {
      prose.push(lines[index++]);
      continue;
    }
    flushProse();
    const marker = opening[2][0];
    const width = opening[2].length;
    const closing = new RegExp(`^\\s*${marker}{${width},}\\s*$`);
    const block = [lines[index++]];
    while (index < lines.length) {
      const line = lines[index++];
      block.push(line);
      if (closing.test(line)) break;
    }
    units.push(block.join("\n"));
  }
  flushProse();
  return units;
}

function splitLongUnit(unit, maxChars) {
  if (unit.length <= maxChars) return [unit];
  if (/^\s*(`{3,}|~{3,})/.test(unit)) return [unit];
  const lines = unit.split("\n");
  const pieces = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxChars && current) {
      pieces.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function makeChunks(markdown, maxChars) {
  const units = splitUnits(markdown).flatMap((unit) => splitLongUnit(unit, maxChars));
  const chunks = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = unit;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function stripAccidentalWrapper(text) {
  const trimmed = text.trim();
  const match = /^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

function validateTranslatedChunk(source, translated) {
  const sourceTokens = source.match(/@@P\d{6}@@/g) || [];
  const translatedTokens = translated.match(/@@P\d{6}@@/g) || [];
  if (!sameArray([...sourceTokens].sort(), [...translatedTokens].sort())) {
    throw new Error("protected placeholders changed");
  }

  const sourceFences = extractFences(source).map((fence) => fence.language);
  const translatedFences = extractFences(translated).map((fence) => fence.language);
  if (!sameArray(sourceFences, translatedFences)) throw new Error("fenced block structure changed");
  if (!sameArray(headingLevels(source), headingLevels(translated))) {
    throw new Error("heading structure changed inside a chunk");
  }
}

function promptFor(chunk) {
  return `Translate the following Chinese technical Markdown into precise, natural English.

Rules:
1. Return only the translated Markdown. Do not wrap it in another code fence.
2. Do not summarize, omit, expand, fact-check, or add commentary.
3. Preserve heading levels, heading numbering, lists, tables, blockquotes, blank-line structure, and horizontal rules.
4. Copy every placeholder matching @@P followed by six digits followed by @@ exactly once and unchanged.
5. Preserve all code, identifiers, commands, paths, API names, URLs, link targets, HTML, and TeX.
6. In Mermaid and text-diagram blocks, preserve syntax, node IDs, arrows, edge structure, and directives. Translate only human-readable Chinese labels.
7. Keep established technical terms when appropriate: kernel, runtime, lowering, pass, IR, ABI, cache line, happens-before, acquire, release, relaxed, fence, warp, block, thread, shape, layout, tensor, bufferization, and workqueue.
8. Translate Chinese link text but never change its target.

Markdown begins below:

${chunk}`;
}

async function requestTranslation(chunk, api) {
  const url = `${api.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let lastError;

  for (let attempt = 1; attempt <= 4; ++attempt) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${api.key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: api.model,
          messages: [
            {
              role: "system",
              content: "You are a meticulous technical translator. Preserve Markdown and protected tokens exactly."
            },
            { role: "user", content: promptFor(chunk) }
          ],
          stream: false,
          max_tokens: 16000
        })
      });

      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
      const parsed = JSON.parse(body);
      const choice = parsed.choices?.[0];
      if (!choice?.message?.content) throw new Error("API response did not contain translated content");
      if (choice.finish_reason && choice.finish_reason !== "stop") {
        throw new Error(`translation stopped with finish_reason=${choice.finish_reason}`);
      }
      return stripAccidentalWrapper(choice.message.content);
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

function loadCache(slug) {
  const cachePath = path.join(CACHE_DIR, `${slug}.json`);
  if (!fs.existsSync(cachePath)) return { chunks: {} };
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return cache && typeof cache.chunks === "object" ? cache : { chunks: {} };
  } catch {
    return { chunks: {} };
  }
}

function saveCache(slug, cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `${slug}.json`);
  const tempPath = `${cachePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, cachePath);
}

function writeAtomically(filename, content) {
  const tempPath = `${filename}.tmp`;
  fs.writeFileSync(tempPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  fs.renameSync(tempPath, filename);
}

async function translatePost(post, options, api) {
  const inputPath = sourcePath(post.slug);
  const outputPath = englishPath(post.slug);
  if (!fs.existsSync(inputPath)) throw new Error(`${post.slug}: missing Chinese source`);
  if (fs.existsSync(outputPath) && !options.force) {
    console.log(`[skip] ${post.slug}: English file already exists`);
    return;
  }

  const source = fs.readFileSync(inputPath, "utf8");
  const protectedDocument = protectMarkdown(source);
  const chunks = makeChunks(protectedDocument.text, options.maxChars);
  console.log(`[post] ${post.slug}: ${source.length} chars, ${chunks.length} request(s)`);

  if (options.dryRun) return;

  const cache = loadCache(post.slug);
  cache.model = api.model;
  cache.sourceHash = sha256(source);
  const translatedChunks = [];

  for (let index = 0; index < chunks.length; ++index) {
    const chunk = chunks[index];
    const chunkKey = sha256(`${api.model}\0${chunk}`);
    let translated = cache.chunks[chunkKey];
    if (typeof translated === "string") {
      try {
        validateTranslatedChunk(chunk, translated);
        console.log(`  [cache ${index + 1}/${chunks.length}]`);
      } catch {
        delete cache.chunks[chunkKey];
        translated = null;
      }
    }
    if (typeof translated !== "string") {
      console.log(`  [translate ${index + 1}/${chunks.length}]`);
      translated = await requestTranslation(chunk, api);
      validateTranslatedChunk(chunk, translated);
      cache.chunks[chunkKey] = translated;
      saveCache(post.slug, cache);
    }
    translatedChunks.push(translated);
  }

  const joined = translatedChunks.join("\n\n");
  const restored = restoreProtected(joined, protectedDocument.protectedValues);
  validatePair(source, restored, post.slug);
  writeAtomically(outputPath, restored);
  console.log(`[done] ${path.relative(ROOT_DIR, outputPath)}`);
}

function checkTranslations(posts) {
  const failures = [];
  for (const post of posts) {
    const inputPath = sourcePath(post.slug);
    const outputPath = englishPath(post.slug);
    try {
      if (!fs.existsSync(inputPath)) throw new Error("missing Chinese source");
      if (!fs.existsSync(outputPath)) throw new Error("missing English file");
      validatePair(
        fs.readFileSync(inputPath, "utf8"),
        fs.readFileSync(outputPath, "utf8"),
        post.slug
      );
      console.log(`[ok] ${post.slug}`);
    } catch (error) {
      failures.push(error.message);
      console.error(`[fail] ${error.message}`);
    }
  }
  if (failures.length) throw new Error(`${failures.length} translation check(s) failed`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const posts = selectedPosts(loadPosts(), options.slugs);

  if (options.check) {
    checkTranslations(posts);
    return;
  }

  let apiKey = process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey && process.env.DEEPSEEK_API_KEY_FILE) {
    apiKey = fs.readFileSync(process.env.DEEPSEEK_API_KEY_FILE, "utf8").trim();
  }
  const api = {
    key: apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
    model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL
  };
  if (!options.dryRun && !api.key) {
    throw new Error("DEEPSEEK_API_KEY or DEEPSEEK_API_KEY_FILE is required; do not put the key in source files");
  }

  for (const post of posts) await translatePost(post, options, api);
}

main().catch((error) => {
  console.error(`translate-blog: ${error.message}`);
  process.exitCode = 1;
});
