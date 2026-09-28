import { SENTENCES, type Chunk, type Role } from '../content/sentences';
import { PATH } from '../content/path';
import { WORDS } from '../content/words';
import { State, type Card } from './memory';

const byId = new Map(WORDS.map(w => [w.id, w]));

/** A sentence to plug together: its pieces (one per chunk, with a role), in the right order. */
export interface PlugItem {
  id: string;
  level: number;
  text: string;
  en: string;
  /** The pieces in the canonical order. */
  chunks: readonly Chunk[];
  /** Punctuation between pieces, before chunk `at`. */
  punct: readonly { at: number; p: string }[];
  /** Pinyin of each word in reading order, as said here. */
  py: readonly string[];
  /** Other valid orders, as role patterns ("T S V O"). */
  alt: readonly string[];
  /** The grammar stage it belongs to (see STAGES). */
  stage: number;
}

/** The grammar, a step at a time: each stage opens once a few sentences of the one before are solved. */
export const STAGES: readonly { name: string; zh: string }[] = [
  { name: 'Who does it', zh: '谁做' },
  { name: '…and to what', zh: '做什么' },
  { name: 'When', zh: '什么时候' },
  { name: 'Where', zh: '在哪儿' },
  { name: 'How', zh: '怎么样' },
  { name: 'Not', zh: '不和没' },
  { name: 'Questions', zh: '吗和呢' },
  { name: 'Measure words', zh: '量词' },
  { name: 'Done and been', zh: '了和过' },
  { name: '把 and 被', zh: '把和被' }
];

/** Sentences of a stage to solve before the next one opens. */
export const TO_OPEN = 3;

const heads = (c: Chunk) => c.words.map(id => byId.get(id)?.h ?? '');

/** The stage a sentence teaches: the furthest grammar point it uses. */
export function stageOf(chunks: readonly Chunk[]): number {
  const roles = new Set(chunks.map(c => c.role));
  const words = chunks.flatMap(heads);
  const pos = chunks.flatMap(c => c.words.flatMap(id => byId.get(id)?.pos ?? []));
  if (words.some(w => w === '把' || w === '被')) return 9;
  if (words.some(w => w === '了' || w === '过')) return 8;
  if (pos.includes('mw') || pos.includes('numMw')) return 7;
  if (words.some(w => w === '吗' || w === '呢')) return 6;
  if (words.some(w => w === '不' || w === '没' || w === '没有')) return 5;
  if (roles.has('A')) return 4;
  if (roles.has('P')) return 3;
  if (roles.has('T')) return 2;
  if (roles.has('O')) return 1;
  return 0;
}

const levelOf = (chunks: readonly Chunk[]) => Math.max(1, ...chunks.flatMap(c => c.words.map(id => byId.get(id)?.level ?? 1)));

/** Every sentence with a role on each piece: the tagged example sentences and the path's sentences to build. */
export const PLUG_ITEMS: readonly PlugItem[] = (() => {
  const out = new Map<string, PlugItem>();
  for (const s of SENTENCES) {
    if (!s.chunks.length || !s.chunks.every(c => c.role)) continue;
    out.set(s.text, { id: s.id, level: s.level, text: s.text, en: s.en, chunks: s.chunks, punct: s.punct, py: s.py, alt: s.alt ?? [], stage: stageOf(s.chunks) });
  }
  for (const b of PATH.units.flatMap(u => u.lessons.flatMap(l => l.builds))) {
    if (out.has(b.text) || !b.chunks.every(c => c.role)) continue;
    out.set(b.text, { id: b.id, level: levelOf(b.chunks), text: b.text, en: b.en, chunks: b.chunks, punct: b.punct, py: b.py, alt: [], stage: stageOf(b.chunks) });
  }
  return [...out.values()];
})();

/** The stages that have sentences, in order (a stage with none is passed over). */
export const USED_STAGES: readonly number[] = [...new Set(PLUG_ITEMS.map(x => x.stage))].sort((a, b) => a - b);

/**
 * The furthest stage open to the learner: the first, then each next one once TO_OPEN sentences of
 * the one before have been solved (have a card) among those at the learner's level.
 */
export function openStage(items: readonly PlugItem[], cards: Readonly<Record<string, Card>>): number {
  const used = [...new Set(items.map(x => x.stage))].sort((a, b) => a - b);
  let open = used[0] ?? 0;
  for (let i = 0; i < used.length - 1; i++) {
    const solved = items.filter(x => x.stage === used[i] && cards[x.id]).length;
    const total = items.filter(x => x.stage === used[i]).length;
    if (solved >= Math.min(TO_OPEN, total)) open = used[i + 1]; else break;
  }
  return open;
}

/** How much help the pieces give: shape and colour for a new sentence, shape while learning, none once known. */
export type Scaffold = 'shape-colour' | 'shape' | 'none';
export const scaffoldOf = (card: Card | undefined): Scaffold => (!card ? 'shape-colour' : card.state === State.Review ? 'none' : 'shape');

/** Whether a piece of a role may go into a socket: by shape while there are shapes, anywhere without them. */
export const fits = (piece: Role | null, socket: Role | null, scaffold: Scaffold): boolean => scaffold === 'none' || piece === socket;

/** The chunk texts in each valid order: the canonical one, then the alternatives (same-role pieces keep their order). */
export function validOrders(item: PlugItem): string[][] {
  const canon = item.chunks.map(c => heads(c).join(''));
  const orders = [canon];
  for (const alt of item.alt) {
    const roles = alt.split(' ');
    if (roles.length !== item.chunks.length) continue;
    const used = new Set<number>();
    const order: string[] = [];
    for (const r of roles) {
      const k = item.chunks.findIndex((c, i) => !used.has(i) && c.role === r);
      if (k < 0) break;
      used.add(k); order.push(canon[k]);
    }
    if (order.length === canon.length) orders.push(order);
  }
  return orders;
}

/**
 * Checks the pieces as placed (their texts, socket by socket): right if they read in any valid order.
 * Otherwise `wrong` lists the sockets that differ from the closest valid order.
 */
export function checkOrder(item: PlugItem, placed: readonly string[]): { ok: boolean; wrong: number[] } {
  let best: number[] | null = null;
  for (const order of validOrders(item)) {
    const wrong = order.map((t, i) => (placed[i] === t ? -1 : i)).filter(i => i >= 0);
    if (!wrong.length) return { ok: true, wrong: [] };
    if (!best || wrong.length < best.length) best = wrong;
  }
  return { ok: false, wrong: best ?? [] };
}

/** The sentence as placed, with its end punctuation: an alternative order reads as it was built. */
export function placedText(item: PlugItem, placed: readonly string[]): string {
  const canon = item.chunks.map(c => heads(c).join(''));
  if (placed.every((t, i) => t === canon[i])) return item.text;
  const end = item.punct.filter(p => p.at === item.chunks.length).map(p => p.p).join('') || '。';
  return placed.join('') + end;
}

/** A piece's words and their pinyin as said in this sentence. */
export function pieceWords(item: PlugItem, chunk: number): { h: string; p: string }[] {
  let k = item.chunks.slice(0, chunk).reduce((n, c) => n + c.words.length, 0);
  return item.chunks[chunk].words.map(id => ({ h: byId.get(id)?.h ?? '', p: item.py[k++] ?? byId.get(id)?.p ?? '' }));
}

/** How many of a sentence's words the learner has met: new sentences with known words come first. */
export const knownShare = (item: PlugItem, met: Readonly<Record<string, Card>>): number => {
  const ids = item.chunks.flatMap(c => c.words);
  return ids.filter(id => met[id]).length / ids.length;
};

