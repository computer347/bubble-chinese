#!/usr/bin/env node
// Generates voice clips for every word with MiniMax text-to-speech.
//
//   $env:MINIMAX_API_KEY = "..."            (PowerShell)   or put MINIMAX_API_KEY=... in .env.local
//   node scripts/generate-audio.mjs --sample   render a few words in several voices, then open audio-samples/index.html
//   node scripts/generate-audio.mjs            render every missing or changed clip (normal + slow)
//   node scripts/generate-audio.mjs --voice "Chinese (Mandarin)_Warm_Girl" --force
//   node scripts/generate-audio.mjs --status --voice "..."   list words and sentences still missing clips (no API calls)
//   --only words | --only sentences   render just one kind (sentences include the path's dialogue lines)
//
// Options: --voice <id>  --limit <n>  --rpm <n> (requests per minute, default 50; MiniMax allows 60 on pay-as-you-go)
//          --force (re-render everything)  --dry-run (show what would be sent)
// Mainland China accounts: set MINIMAX_API_HOST=https://api.minimaxi.com
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestBody, requestHash, clipFile, polyphones, pronunciationRule, sentenceRequestBody, sentenceFile, wordTimings, SPEEDS, SAMPLE_VOICES, DEFAULT_VOICE, MODEL } from './audio-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORDS = JSON.parse(readFileSync(join(root, 'src/content/generated/hsk.json'), 'utf8'));
const MANIFEST = join(root, 'src/content/generated/audio.json');
const SENTENCES = JSON.parse(readFileSync(join(root, 'src/content/generated/sentences.json'), 'utf8'));
const SENTENCE_MANIFEST = join(root, 'src/content/generated/sentence-audio.json');
// the path's dialogue lines, recorded like sentences: one entry per distinct line, its HSK words
// listed for pinning readings (names are left to the voice)
const PATH = JSON.parse(readFileSync(join(root, 'src/content/generated/path.json'), 'utf8'));
const DIALOGUE = [...new Map(PATH.units.flatMap(u => u.lessons.flatMap(l => l.dialogue)).map(d => [d.id, {
  id: d.id, text: d.text, chunks: [{ role: null, words: d.tokens.filter(t => t.id).map(t => t.id) }]
}])).values()];
// the stories' sentences, the same way
const STORY_FILE = join(root, 'src/content/generated/stories.json');
const STORY_LINES = existsSync(STORY_FILE) ? [...new Map(JSON.parse(readFileSync(STORY_FILE, 'utf8')).flatMap(st => st.paras.flat()).map(l => [l.id, {
  id: l.id, text: l.text, chunks: [{ role: null, words: l.tokens.filter(t => t.id).map(t => t.id) }]
}])).values()] : [];
const SPOKEN = [...SENTENCES, ...DIALOGUE, ...STORY_LINES];
const WORDS_BY_ID = new Map(WORDS.map(w => [w.id, w]));
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
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000)
    });
  } catch (e) {
    // "fetch failed": a dropped connection, DNS hiccup or timeout. Wait and try again.
    if (attempt < 8) { await sleep(2000 * 2 ** Math.min(attempt - 1, 4)); return synthesize(body, attempt + 1); }
    throw new Error(`network: ${e.cause?.code ?? e.name ?? e.message}`);
  }
  const json = await res.json().catch(() => ({}));
  const code = json?.base_resp?.status_code;
  if (res.ok && code === 0 && json?.data?.audio) return { audio: Buffer.from(json.data.audio, 'hex'), subtitleUrl: json.data.subtitle_file };
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
      if (!flag('dry-run')) writeFileSync(join(dir, file), (await synthesize(requestBody(w, SPEEDS.normal, voice))).audio);
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

/** Downloads the word-level subtitle file for a sentence clip and turns it into per-word times. */
async function timingsFor(sentence, url, kind) {
  if (!url) return null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const words = wordTimings(json, sentence, WORDS_BY_ID);
      if (!words) {
        const dir = join(root, 'data/subtitles-debug');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${sentence.id}-${kind}.json`), JSON.stringify(json, null, 1));
      }
      return words;
    } catch {
      await sleep(1500 * attempt);
    }
  }
  return null;
}

/** Lists words whose clips are missing or out of date, without calling the API. */
function status() {
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  const voice = opt('voice', DEFAULT_VOICE);
  const rows = [];
  for (const w of WORDS) {
    const missing = ['normal', 'slow'].filter(kind => {
      const have = manifest[w.id]?.[kind];
      const hash = requestHash(requestBody(w, SPEEDS[kind], voice));
      return !have || !existsSync(join(AUDIO_DIR, have.file)) || (!flag('any-voice') && have.hash !== hash);
    });
    if (missing.length) rows.push([w.h, w.p, w.e, missing.join('+')]);
  }
  const out = join(root, 'data/audio-missing.tsv');
  writeFileSync(out, ['characters\tpinyin\tgloss\tmissing', ...rows.map(r => r.join('\t'))].join('\n') + '\n');
  const smanifest = existsSync(SENTENCE_MANIFEST) ? JSON.parse(readFileSync(SENTENCE_MANIFEST, 'utf8')) : {};
  const sMissing = SPOKEN.filter(st => ['normal', 'slow'].some(kind => {
    const have = smanifest[st.id]?.[kind];
    return !have || !existsSync(join(AUDIO_DIR, have.file)) || (!flag('any-voice') && have.hash !== requestHash(sentenceRequestBody(st, WORDS_BY_ID, SPEEDS[kind], voice)));
  }));
  console.log(`${SPOKEN.length - sMissing.length} of ${SPOKEN.length} sentences, dialogue and story lines have both clips.${sMissing.length ? ' Missing: ' + sMissing.slice(0, 8).map(s => s.text).join(' ') + (sMissing.length > 8 ? ' …' : '') : ''}`);
  const done = WORDS.length - rows.length;
  console.log(`${done} of ${WORDS.length} words have both clips for voice "${voice}". ${rows.length} still need rendering.`);
  if (rows.length) {
    console.log(rows.slice(0, 40).map(r => `  ${r[0]} ${r[1]} (${r[3]})`).join('\n') + (rows.length > 40 ? `\n  … and ${rows.length - 40} more` : ''));
    console.log(`Full list: data/audio-missing.tsv. Run the same generate command again to render only these.`);
  }
}

async function main() {
  if (flag('status')) return status();
  if (!KEY && !flag('dry-run')) {
    console.error('Set MINIMAX_API_KEY first (PowerShell: $env:MINIMAX_API_KEY = "your key"), or add it to .env.local.');
    process.exit(1);
  }
  if (flag('sample')) return sample();
  const voice = opt('voice', DEFAULT_VOICE);
  const limit = Number(opt('limit', Infinity));
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  mkdirSync(AUDIO_DIR, { recursive: true });

  const smanifest = existsSync(SENTENCE_MANIFEST) ? JSON.parse(readFileSync(SENTENCE_MANIFEST, 'utf8')) : {};
  const only = opt('only', 'all');
  const jobs = [];
  if (only !== 'words') {
    for (const st of SPOKEN) {
      for (const kind of ['normal', 'slow']) {
        const body = sentenceRequestBody(st, WORDS_BY_ID, SPEEDS[kind], voice);
        const hash = requestHash(body);
        const have = smanifest[st.id]?.[kind];
        if (!flag('force') && have?.hash === hash && existsSync(join(AUDIO_DIR, have.file))) continue;
        jobs.push({ sentence: st, kind, body, hash, file: sentenceFile(st, kind) });
      }
    }
  }
  for (const w of only === 'sentences' ? [] : WORDS) {
    for (const kind of ['normal', 'slow']) {
      const body = requestBody(w, SPEEDS[kind], voice);
      const hash = requestHash(body);
      const file = clipFile(w, kind);
      const have = manifest[w.id]?.[kind];
      if (!flag('force') && have?.hash === hash && existsSync(join(AUDIO_DIR, have.file))) continue;
      jobs.push({ w, kind, body, hash, file });
    }
  }
  const saveManifests = () => {
    writeFileSync(MANIFEST, JSON.stringify(sortKeys(manifest), null, 1) + '\n');
    // one sentence per line keeps the word timings readable in diffs
    writeFileSync(SENTENCE_MANIFEST, '{\n' + Object.keys(smanifest).sort().map(k => ` ${JSON.stringify(k)}: ${JSON.stringify(smanifest[k])}`).join(',\n') + '\n}\n');
  };
  const todo = jobs.slice(0, limit);
  const chars = todo.reduce((n, j) => n + j.body.text.length, 0);
  console.log(`${todo.length} clips to render (${chars} characters), voice "${voice}".`);
  if (flag('dry-run')) { console.log(JSON.stringify(todo.slice(0, 3).map(j => j.body), null, 2)); return; }

  let done = 0, failed = 0;
  await pool(todo, 3, async j => {
    try {
      if (j.sentence) {
        const { audio, subtitleUrl } = await synthesize(j.body);
        writeFileSync(join(AUDIO_DIR, j.file), audio);
        const words = await timingsFor(j.sentence, subtitleUrl, j.kind);
        smanifest[j.sentence.id] = { ...smanifest[j.sentence.id], text: j.sentence.text, [j.kind]: { file: j.file, hash: j.hash, words } };
      } else {
        writeFileSync(join(AUDIO_DIR, j.file), (await synthesize(j.body)).audio);
        manifest[j.w.id] = { ...manifest[j.w.id], p: j.w.p, [j.kind]: { file: j.file, hash: j.hash } };
      }
      done++;
    } catch (e) {
      failed++;
      console.error(`\n${j.w.h} (${j.kind}): ${e.message}`);
      if (/1004|authentication/i.test(e.message)) { console.error('Check MINIMAX_API_KEY (and MINIMAX_API_HOST for mainland accounts).'); process.exit(1); }
    }
    if ((done + failed) % 20 === 0) {
      process.stdout.write(`\r${done + failed}/${todo.length}`);
      saveManifests();      // save progress as we go
    }
  });
  saveManifests();
  writeReview(voice);
  const untimed = Object.values(smanifest).flatMap(e => [e.normal, e.slow]).filter(c => c && !c.words).length;
  console.log(`\nDone: ${done} rendered, ${failed} failed. Manifests: src/content/generated/audio.json and sentence-audio.json. Review list: data/audio-review.md`);
  if (untimed) console.log(`${untimed} sentence clips have no word timings; tapping their words uses the single-word clips. The raw subtitle files are in data/subtitles-debug/ if you want me to look.`);
  if (failed) process.exit(1);
}

// stable order so the manifest diffs cleanly: words by id, then p, normal, slow
const sortKeys = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, { p: o[k].p, ...(o[k].normal ? { normal: o[k].normal } : {}), ...(o[k].slow ? { slow: o[k].slow } : {}) }]));

main().catch(e => { console.error(e); process.exit(1); });
