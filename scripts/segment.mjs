// Splitting Chinese sentences into syllabus words, and reading them correctly in context.
// Shared by scripts/import-tatoeba.mjs and scripts/build-content.mjs; unit-tested.

export const PUNCT = new Set(['。', '？', '！', '，']);
const HANZI = /[\u3400-\u9fff]/;

/**
 * Splits a sentence into the fewest words from the vocabulary (a Map of characters → word).
 * Returns the tokens (words and punctuation), or null if some part is not in the vocabulary.
 */
export function segment(text, vocab) {
  const chars = [...text];
  const n = chars.length;
  const maxLen = Math.max(...[...vocab.keys()].map(k => [...k].length));
  const best = Array(n + 1).fill(null);
  best[0] = { cost: 0, toks: [] };
  for (let i = 0; i < n; i++) {
    if (!best[i]) continue;
    if (PUNCT.has(chars[i])) {
      if (!best[i + 1] || best[i + 1].cost > best[i].cost) best[i + 1] = { cost: best[i].cost, toks: [...best[i].toks, chars[i]] };
      continue;
    }
    for (let L = 1; L <= Math.min(maxLen, n - i); L++) {
      const t = chars.slice(i, i + L).join('');
      if (!vocab.has(t)) continue;
      const cost = best[i].cost + 1;
      if (!best[i + L] || best[i + L].cost > cost) best[i + L] = { cost, toks: [...best[i].toks, t] };
    }
  }
  return best[n] ? best[n].toks : null;
}

const TONE = { 'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4, 'ē': 1, 'é': 2, 'ě': 3, 'è': 4, 'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4, 'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4, 'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4, 'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4 };
/** Tone (1–4, or 5 for neutral) of the first syllable of a numbered-pinyin string. */
const firstTone = pn => Number(pn.split(' ')[0].slice(-1));

/**
 * Pinyin for each token as it is actually said in the sentence: 不 becomes bú before a fourth
 * tone, and 一 becomes yí before a fourth tone and yì before the others (but stays yī at the end).
 */
export function contextPinyin(tokens, vocab) {
  const words = tokens.map(t => (PUNCT.has(t) ? null : vocab.get(t)));
  return words.map((w, i) => {
    if (!w) return tokens[i];
    const next = words.slice(i + 1).find(Boolean);
    const nextTone = next ? firstTone(next.pn) : 0;
    const beforePunct = PUNCT.has(tokens[i + 1] ?? '。');
    if (w.h === '不') return nextTone === 4 && !beforePunct ? 'bú' : 'bù';
    if (w.h === '一') {
      // counting keeps yī: 第一 (first), 十一, 一月; so does the end of a phrase
      if (beforePunct || !next || /^[第零一二三四五六七八九十]$/.test(tokens[i - 1] ?? '') || /^[月号日]$/.test(tokens[i + 1] ?? '')) return 'yī';
      return nextTone === 4 ? 'yí' : nextTone >= 1 && nextTone <= 3 ? 'yì' : 'yī';
    }
    return w.p;
  });
}

/**
 * Sentences where a character is probably read differently from its syllabus entry are skipped,
 * so the pinyin shown and the pinned pronunciation are always right. Returns the reason, or null.
 */
export function readingProblem(tokens) {
  const prev = i => tokens[i - 1] ?? '';
  const next = i => tokens[i + 1] ?? '';
  const NUM = new Set(['一', '两', '二', '三', '四', '五', '六', '七', '八', '九', '十', '几', '这', '那', '每', '哪']);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '还' && /^(给|钱|书|你|我|他|她|了)$/.test(next(i))) return '还 as huán (to return)';
    if (t === '长' && /^(大|得|了|高)$/.test(next(i))) return '长 as zhǎng (to grow)';
    if (t === '只' && !NUM.has(prev(i))) return '只 as zhǐ (only), not the measure word zhī';
    if (t === '得' && (i === 0 || /^(我|你|他|她|它|我们|你们|他们|她们|就|也|还|都|不|要)$/.test(prev(i)))) return '得 as děi (must)';
    if (t === '地') return '地 as dì (ground) rather than the particle';
    if (t === '着' && /^(睡|找|看|见)$/.test(prev(i))) return '着 as zháo (result)';
    if (t === '过') return '过 as either guò or guo';
    if (t === '都' && /^(市|城)$/.test(next(i))) return '都 as dū';
    if (t === '行') return '行 as xíng or háng';
  }
  return null;
}

/** Hanzi count, ignoring punctuation. */
export const hanziCount = s => [...s].filter(c => HANZI.test(c)).length;

/** Parses CC-CEDICT text into a Map of simplified characters → [{ py, def }]. */
export function parseCedict(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^\S+ (\S+) \[([^\]]+)\] \/(.*)\/$/);
    if (!m) continue;
    const [, simp, py, def] = m;
    if (!map.has(simp)) map.set(simp, []);
    map.get(simp).push({ py, def });
  }
  return map;
}

/** Compounds whose meaning is not the sum of their HSK parts (十分 "very", not "ten minutes"). */
export const MISLEADING = new Set(['十分', '找零', '要是', '天下', '东北', '日子', '大人', '点心', '小心', '口气', '上下', '左右', '多少钱']);

const FUNCTION_CHARS = new Set(['了', '着', '的', '得', '都']);
const syllables = py => py.toLowerCase().replace(/u:/g, 'ü').split(/\s+/);
const letters = s => s.replace(/[1-5]$/, '');
const tone = s => Number(s.slice(-1));

/**
 * Checks a segmented sentence against the full CC-CEDICT dictionary: a name, a compound read
 * differently from its HSK parts, or a compound whose meaning isn't the sum of its parts means
 * the word-by-word pinyin and glosses would mislead, so the sentence is skipped.
 */
export function compoundProblem(tokens, cedict, vocab) {
  const words = tokens.filter(t => !PUNCT.has(t));
  for (let i = 0; i < words.length; i++) {
    let span = '';
    for (let j = i; j < Math.min(words.length, i + 4); j++) {
      span += words[j];
      if (j === i) continue;                                  // compounds of 2+ syllabus words
      if (vocab.has(span)) continue;
      const entries = cedict.get(span);
      if (!entries) continue;
      if (MISLEADING.has(span)) return `${span} is one word, not ${words.slice(i, j + 1).join(' + ')}`;
      // names (日本 Japan) — but weekdays, months and 中国… read as their parts
      const composed = /^(星期|周)[一二三四五六日天]$|^[一二三四五六七八九十]+月$|^中国/.test(span);
      if (!composed && entries.every(e => /^[A-Z]/.test(e.py))) return `${span} is a name`;
      const parts = words.slice(i, j + 1).flatMap(w => vocab.get(w).pn.split(' '));
      const readsSame = entries.some(e => {
        const s = syllables(e.py);
        if (s.length !== parts.length) return false;
        return s.every((x, k) => {
          const ch = [...span][k];
          // particles and 都 keep their everyday reading even when a dictionary idiom reads them otherwise (到了, 穿着, 都会)
          if (FUNCTION_CHARS.has(ch)) return true;
          if (letters(x) !== letters(parts[k])) return false;
          if (ch === '一' || ch === '不' || tone(x) === 5 || tone(parts[k]) === 5) return true;
          return tone(x) === tone(parts[k]);
        });
      });
      if (!readsSame) return `${span} is read ${entries[0].py}, not as its HSK parts`;
    }
  }
  return null;
}

/**
 * Words that are part of a larger dictionary word in this sentence (后 in 后天, 家 in 回家).
 * The sentence is still fine to read, but it is not used as the example for those words.
 */
export function boundWords(tokens, cedict, vocab) {
  const words = tokens.filter(t => !PUNCT.has(t));
  const bound = new Set();
  for (let i = 0; i < words.length; i++) {
    let span = '';
    for (let j = i; j < Math.min(words.length, i + 4); j++) {
      span += words[j];
      if (j === i || vocab.has(span) || !cedict.has(span)) continue;
      for (let k = i; k <= j; k++) bound.add(words[k]);
    }
  }
  return [...bound];
}
