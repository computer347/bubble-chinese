import { BUBBLE_PALETTES, type Palette, type CoreMaterial, type Mode } from '../content/palettes';

/** The two looks: soft soap bubbles, or ink on paper with paper lanterns. */
export type StyleId = 'bubble' | 'ink';
export const STYLES: readonly StyleId[] = ['bubble', 'ink'];

export interface Theme {
  id: StyleId;
  /** Shown on the style choice. */
  name: string;
  /** Grounds for the light and the dark mode. */
  palettes: Record<Mode, readonly Palette[]>;
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

const inkPal = (bg: string, ui: string, shadow: string, mat: CoreMaterial): Palette => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(ui.slice(i, i + 2), 16));
  return { bg, ui, dim: `rgba(${r},${g},${b},.74)`, line: `rgba(${r},${g},${b},.3)`, shadow, kind: 'clay', mat };
};

const INK_PALETTES: Record<Mode, readonly Palette[]> = {
  light: [
    // rice paper, red lantern
    inkPal('#EFE4CC', '#1E1A16', 'rgba(90,60,20,.34)', lantern('#C62A1F', '#FF5A1F')),
    // old scroll, deep red lantern
    inkPal('#E6D3AA', '#2A1B0E', 'rgba(100,60,10,.36)', lantern('#A61E17', '#FF4A12')),
    // ink wash grey, red lantern
    inkPal('#DDD8CC', '#1A1A1A', 'rgba(40,36,30,.34)', lantern('#B3261E', '#FF5020')),
    // pale jade silk, golden lantern
    inkPal('#DCE6D6', '#16241C', 'rgba(30,60,40,.3)', lantern('#D99A2B', '#FFB347', 0.6))
  ],
  dark: [
    // lantern festival at night: warm glow on dark
    inkPal('#1C1512', '#F0D9A8', 'rgba(0,0,0,.55)', lantern('#D2301F', '#FF7A2A', 0.95)),
    // lacquer, golden lantern
    inkPal('#3A120D', '#F6E7C8', 'rgba(20,0,0,.55)', lantern('#E8B04A', '#FFC870', 0.7)),
    // night jade, red lantern
    inkPal('#15332B', '#EEE3C8', 'rgba(0,14,10,.55)', lantern('#C62A1F', '#FF6A2A', 0.8)),
    // ink stone, red lantern
    inkPal('#18181A', '#EDE6D6', 'rgba(0,0,0,.6)', lantern('#C0281D', '#FF5A22', 0.9))
  ]
};

export const THEMES: Record<StyleId, Theme> = {
  bubble: {
    id: 'bubble', name: 'Bubbles', palettes: BUBBLE_PALETTES, squash: 1, tail: 1, paper: false,
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
