#!/usr/bin/env node
// Generates voice clips for every word with MiniMax text-to-speech.
//
//   $env:MINIMAX_API_KEY = "..."            (PowerShell)   or put MINIMAX_API_KEY=... in .env.local
//   node scripts/generate-audio.mjs --sample   render a few words in several voices, then open audio-samples/index.html
//   node scripts/generate-audio.mjs            render every missing or changed clip (normal + slow)
//   node scripts/generate-audio.mjs --voice "Chinese (Mandarin)_Warm_Girl" --force
//
// Options: --voice <id>  --limit <n>  --rpm <n> (requests per minute, default 50; MiniMax allows 60 on pay-as-you-go)
//          --force (re-render everything)  --dry-run (show what would be sent)
// Mainland China accounts: set MINIMAX_API_HOST=https://api.minimaxi.com
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestBody, requestHash, clipFile, polyphones, pronunciationRule, SPEEDS, SAMPLE_VOICES, DEFAULT_VOICE, MODEL } from './audio-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORDS = JSON.parse(readFileSync(join(root, 'src/content/generated/hsk.json'), 'utf8'));
const MANIFEST = join(root, 'src/content/generated/audio.json');
const AUDIO_DIR = join(root, 'public/audio');

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

function loadEnv() {
  const f = join(root, '.env.local');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();
const KEY = process.env.MINIMAX_API_KEY;
const HOST = (process.env.MINIMAX_API_HOST || 'https://api.minimax.io').replace(/\/$/, '');
const GROUP = process.env.MINIMAX_GROUP_ID;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// stay under MiniMax's per-minute request limit (60 RPM for T2A on pay-as-you-go)
const GAP = 60_000 / Number(opt('rpm', 50));
let nextSlot = 0;
async function throttle() {
  const now = Date.now(), wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + GAP;
  if (wait) await sleep(wait);
}

async function synthesize(body, attempt = 1) {
  await throttle();
  const url = `${HOST}/v1/t2a_v2${GROUP ? `?GroupId=${encodeURIComponent(GROUP)}` : ''}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  const code = json?.base_resp?.status_code;
  if (res.ok && code === 0 && json?.data?.audio) return Buffer.from(json.data.audio, 'hex');
  const retryable = res.status === 429 || res.status >= 500 || code === 1000 || code === 1001 || code === 1002 || code === 1039;
  if (retryable && attempt < 6) { await sleep(1500 * 2 ** (attempt - 1)); return synthesize(body, attempt + 1); }
  const msg = json?.base_resp ? `${json.base_resp.status_code} ${json.base_resp.status_msg}` : `HTTP ${res.status}`;
  throw new Error(`MiniMax: ${msg}`);
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

async function sample() {
  const picks = ['爸爸', '学生', '一点儿', '女儿', '长', '不客气', '朋友', '绿色'].map(h => WORDS.find(w => w.h === h)).filter(Boolean);
  const dir = join(root, 'audio-samples');
  mkdirSync(dir, { recursive: true });
  const rows = [];
  for (const voice of SAMPLE_VOICES) {
    const cells = [];
    for (const w of picks) {
      const file = `${voice.replace(/[^A-Za-z]+/g, '_')}-${clipFile(w, 'normal')}`;
      if (!flag('dry-run')) writeFileSync(join(dir, file), await synthesize(requestBody(w, SPEEDS.normal, voice)));
      cells.push(`<td><button onclick="new Audio('${file}').play()">${w.h}</button></td>`);
      process.stdout.write('.');
    }
    rows.push(`<tr><th>${voice.replace('Chinese (Mandarin)_', '').replace(/_/g, ' ')}</th>${cells.join('')}</tr>`);
  }
  writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Voice samples</title>
<style>body{font:16px system-ui;padding:24px}td,th{padding:6px 10px;text-align:left}button{font-size:22px;padding:6px 12px}</style>
<h1>MiniMax ${MODEL} voice samples</h1><p>Click to play. Pick a voice, then run: node scripts/generate-audio.mjs --voice "Chinese (Mandarin)_…"</p>
<table><tr><th>Voice</th>${picks.map(w => `<th>${w.p}<br><small>${w.e}</small></th>`).join('')}</tr>${rows.join('\n')}</table>`);
  console.log(`\nOpen audio-samples/index.html to compare ${SAMPLE_VOICES.length} voices.`);
}

function writeReview(voice) {
  const poly = polyphones(WORDS);
  const lines = ['# Audio review', '', `Voice: ${voice}, model ${MODEL}. Every clip pins the syllabus reading with a pronunciation rule;`,
    'these words contain characters with more than one reading, so give each a listen (normal and slow) in the words panel.', ''];
  for (const w of WORDS) {
    const hits = [...w.h].filter(c => poly.has(c));
    if (!hits.length) continue;
    lines.push(`- [ ] ${w.h} ${w.p} (${w.e}): ${hits.map(c => `${c} ${poly.get(c).join('/')}`).join(', ')}${pronunciationRule(w.h, w.pn) ? '' : ' — not pinned, check carefully'}`);
  }
  writeFileSync(join(root, 'data/audio-review.md'), lines.join('\n') + '\n');
}

async function main() {
  if (!KEY && !flag('dry-run')) {
    console.error('Set MINIMAX_API_KEY first (PowerShell: $env:MINIMAX_API_KEY = "your key"), or add it to .env.local.');
    process.exit(1);
  }
  if (flag('sample')) return sample();
  const voice = opt('voice', DEFAULT_VOICE);
  const limit = Number(opt('limit', Infinity));
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  mkdirSync(AUDIO_DIR, { recursive: true });

  const jobs = [];
  for (const w of WORDS) {
    for (const kind of ['normal', 'slow']) {
      const body = requestBody(w, SPEEDS[kind], voice);
      const hash = requestHash(body);
      const file = clipFile(w, kind);
      const have = manifest[w.id]?.[kind];
      if (!flag('force') && have?.hash === hash && existsSync(join(AUDIO_DIR, have.file))) continue;
      jobs.push({ w, kind, body, hash, file });
    }
  }
  const todo = jobs.slice(0, limit);
  const chars = todo.reduce((n, j) => n + j.body.text.length, 0);
  console.log(`${todo.length} clips to render (${chars} characters), voice "${voice}".`);
  if (flag('dry-run')) { console.log(JSON.stringify(todo.slice(0, 3).map(j => j.body), null, 2)); return; }

  let done = 0, failed = 0;
  await pool(todo, 3, async j => {
    try {
      writeFileSync(join(AUDIO_DIR, j.file), await synthesize(j.body));
      manifest[j.w.id] = { ...manifest[j.w.id], p: j.w.p, [j.kind]: { file: j.file, hash: j.hash } };
      done++;
    } catch (e) {
      failed++;
      console.error(`\n${j.w.h} (${j.kind}): ${e.message}`);
      if (/1004|authentication/i.test(e.message)) { console.error('Check MINIMAX_API_KEY (and MINIMAX_API_HOST for mainland accounts).'); process.exit(1); }
    }
    if ((done + failed) % 20 === 0) {
      process.stdout.write(`\r${done + failed}/${todo.length}`);
      writeFileSync(MANIFEST, JSON.stringify(sortKeys(manifest), null, 1) + '\n');      // save progress as we go
    }
  });
  writeFileSync(MANIFEST, JSON.stringify(sortKeys(manifest), null, 1) + '\n');
  writeReview(voice);
  console.log(`\nDone: ${done} rendered, ${failed} failed. Manifest: src/content/generated/audio.json. Review list: data/audio-review.md`);
  if (failed) process.exit(1);
}

// stable order so the manifest diffs cleanly: words by id, then p, normal, slow
const sortKeys = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, { p: o[k].p, ...(o[k].normal ? { normal: o[k].normal } : {}), ...(o[k].slow ? { slow: o[k].slow } : {}) }]));

main().catch(e => { console.error(e); process.exit(1); });
