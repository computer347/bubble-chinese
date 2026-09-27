import { PALETTES, type Palette, type CoreMaterial } from '../content/palettes';

/** The two looks: soft soap bubbles, or ink on paper with paper lanterns. */
export type StyleId = 'bubble' | 'ink';
export const STYLES: readonly StyleId[] = ['bubble', 'ink'];

export interface Theme {
  id: StyleId;
  /** Shown on the style choice. */
  name: string;
  palettes: readonly Palette[];
  /** The body is drawn this much shorter than wide (1 is round; a lantern is squat). */
  squash: number;
  /** How far below its centre something hangs (a lantern's tassel), in radii; 1 for a bubble. */
  tail: number;
  /** Paper grain and aged edges on the wall behind the bubble. */
  paper: boolean;
  /** Fonts for the prompt written on the wall. */
  wallFonts: { latin: string; zh: string };
  /** Colours of the scraps that fly when a film pops. */
  shards: readonly string[];
  /** The home screen's heading. */
  homeTitle: string;
}

/** A glowing silk lantern of one colour. */
const lantern = (color: string, glow: string, emissive = 0.55): CoreMaterial => ({
  color, emissiveColor: glow, emissive, roughness: 0.6, metalness: 0, clearcoat: 0,
  iridescence: 0, sheen: 0.8, sheenColor: '#FFC9A0', envMapIntensity: 0.7
});

const INK_PALETTES: readonly Palette[] = [
  // rice paper, red lantern
  { bg: '#EFE4CC', ui: '#1E1A16', dim: 'rgba(30,26,22,.74)', line: 'rgba(30,26,22,.3)', shadow: 'rgba(90,60,20,.34)', kind: 'clay', mat: lantern('#C62A1F', '#FF5A1F') },
  // old scroll, deep red lantern
  { bg: '#E2CDA0', ui: '#2A1B0E', dim: 'rgba(42,27,14,.76)', line: 'rgba(42,27,14,.3)', shadow: 'rgba(100,60,10,.36)', kind: 'clay', mat: lantern('#A61E17', '#FF4A12') },
  // lantern festival at night: warm glow on dark
  { bg: '#1C1512', ui: '#F0D9A8', dim: 'rgba(240,217,168,.74)', line: 'rgba(240,217,168,.3)', shadow: 'rgba(0,0,0,.55)', kind: 'clay', mat: lantern('#D2301F', '#FF7A2A', 0.95) },
  // vermilion wall, golden lantern
  { bg: '#8E2319', ui: '#F6E7C8', dim: 'rgba(246,231,200,.76)', line: 'rgba(246,231,200,.32)', shadow: 'rgba(40,0,0,.5)', kind: 'clay', mat: lantern('#E8B04A', '#FFC870', 0.6) },
  // jade, red lantern
  { bg: '#234F43', ui: '#EEE3C8', dim: 'rgba(238,227,200,.76)', line: 'rgba(238,227,200,.3)', shadow: 'rgba(0,20,14,.5)', kind: 'clay', mat: lantern('#C62A1F', '#FF6A2A', 0.7) },
  // ink wash grey, red lantern
  { bg: '#D9D4C8', ui: '#1A1A1A', dim: 'rgba(26,26,26,.74)', line: 'rgba(26,26,26,.3)', shadow: 'rgba(40,36,30,.34)', kind: 'clay', mat: lantern('#B3261E', '#FF5020') }
];

export const THEMES: Record<StyleId, Theme> = {
  bubble: {
    id: 'bubble', name: 'Bubbles', palettes: PALETTES, squash: 1, tail: 1, paper: false,
    wallFonts: { latin: '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif', zh: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif' },
    shards: ['#ffffff', '#ffd6f5', '#c9f3ff', '#fff4c2'],
    homeTitle: 'Pop a bubble to start'
  },
  ink: {
    // tail: bottom cap at 0.83 r, tassel hanging 0.59 r below it
    id: 'ink', name: 'Ink & lanterns', palettes: INK_PALETTES, squash: 0.86, tail: 1.45, paper: true,
    wallFonts: { latin: '"Cormorant Garamond", Georgia, serif', zh: '"Ma Shan Zheng", "Noto Serif SC", "STKaiti", "KaiTi", serif' },
    shards: ['#1E1A16', '#C62A1F', '#E8B04A', '#F6ECD6'],
    homeTitle: 'Light a lantern to start'
  }
};
