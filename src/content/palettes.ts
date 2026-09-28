export type MaterialKind = 'jelly' | 'chrome' | 'mochi' | 'clay';

/** Look of the coloured core of a bubble. */
export interface CoreMaterial {
  color: string; emissiveColor: string; emissive: number;
  roughness: number; metalness: number; clearcoat: number;
  iridescence: number; sheen: number; sheenColor: string; envMapIntensity: number;
}

/** Soft-body feel. kc is the surface-tension stiffness at the finest mesh. */
export interface Physics { k: number; c: number; kc: number; inertia: number; hover: number; }

export interface Palette {
  bg: string; ui: string; dim: string; line: string; shadow: string;
  kind: MaterialKind; mat: CoreMaterial;
}

export const MATS = {
  jelly:(c: string, e: string): CoreMaterial => ({ color:c, emissiveColor:e, emissive:.28, roughness:.14, metalness:0, clearcoat:1, iridescence:.25, sheen:.5, sheenColor:'#ffffff', envMapIntensity:1.1 }),
  chrome:(): CoreMaterial => ({ color:'#F2F4F8', emissiveColor:'#ffffff', emissive:0, roughness:.05, metalness:1, clearcoat:0, iridescence:.08, sheen:0, sheenColor:'#ffffff', envMapIntensity:1.3 }),
  mochi:(): CoreMaterial => ({ color:'#FFF4EA', emissiveColor:'#ffffff', emissive:0, roughness:.62, metalness:0, clearcoat:.15, iridescence:0, sheen:1, sheenColor:'#ffffff', envMapIntensity:.95 }),
  clay:(): CoreMaterial => ({ color:'#4C76C9', emissiveColor:'#A9C1FF', emissive:0, roughness:.78, metalness:0, clearcoat:.04, iridescence:0, sheen:.45, sheenColor:'#A9C1FF', envMapIntensity:.95 })
};
export const PHYS: Record<MaterialKind, Physics> = {
  jelly: { k:220, c:2.6, kc:120000, inertia:.22, hover:1 },
  chrome:{ k:380, c:1.6, kc:160000, inertia:.14, hover:1.2 },
  mochi: { k:110, c:4.2, kc:50000,  inertia:.3,  hover:.75 },
  clay:  { k:170, c:3.4, kc:80000,  inertia:.24, hover:.9 }
};
/** Light or dark: a pale ground with dark text, or a deep ground with light text. */
export type Mode = 'light' | 'dark';

/** A ground and its text: the text at full strength, dimmed, and as a hairline. */
const ink = (bg: string, ui: string, shadow: string, kind: MaterialKind, mat: CoreMaterial): Palette => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(ui.slice(i, i + 2), 16));
  return { bg, ui, dim: `rgba(${r},${g},${b},.74)`, line: `rgba(${r},${g},${b},.3)`, shadow, kind, mat };
};

/**
 * The bubble style's grounds. Each pop moves to another of the same mode, so the colours change but
 * the text always stands clear of its ground.
 */
export const BUBBLE_PALETTES: Record<Mode, readonly Palette[]> = {
  dark: [
    ink('#151A4E', '#EEF0FF', 'rgba(0,0,20,.55)', 'jelly', MATS.jelly('#FF86BC', '#FF3D8F')),
    ink('#0B3A3A', '#E3FFF9', 'rgba(0,20,18,.55)', 'jelly', MATS.jelly('#FFB22E', '#FF7A00')),
    ink('#2A1038', '#F6E6FF', 'rgba(10,0,14,.6)', 'jelly', MATS.jelly('#C8F25A', '#7BD400')),
    ink('#0F1830', '#EAF0FF', 'rgba(0,0,10,.6)', 'jelly', MATS.jelly('#FF6F59', '#FF3B22')),
    ink('#12301E', '#E6FFEC', 'rgba(0,14,6,.55)', 'chrome', MATS.chrome()),
    ink('#3A0F1E', '#FFE6EE', 'rgba(20,0,6,.6)', 'jelly', MATS.jelly('#5FE1FF', '#1FB8FF'))
  ],
  light: [
    ink('#E9EBFF', '#161A4A', 'rgba(40,50,140,.28)', 'jelly', MATS.jelly('#FF5FA8', '#FF2E88')),
    ink('#FFE6D6', '#3A1606', 'rgba(140,60,20,.28)', 'chrome', MATS.chrome()),
    ink('#E2F3DF', '#17301A', 'rgba(40,90,40,.26)', 'jelly', MATS.jelly('#FF8A3D', '#FF5A00')),
    ink('#FFE2EF', '#3A0A22', 'rgba(140,20,70,.26)', 'jelly', MATS.jelly('#4A5CFF', '#2B3BFF')),
    ink('#DDF0FF', '#0B2545', 'rgba(20,60,120,.28)', 'clay', MATS.clay()),
    ink('#FFF3C4', '#3A2A00', 'rgba(120,80,0,.26)', 'jelly', MATS.jelly('#E8342B', '#FF2A1A'))
  ]
};

/** The first bubble's palette, before a style and mode are applied. */
export const PALETTES: readonly Palette[] = BUBBLE_PALETTES.dark;
