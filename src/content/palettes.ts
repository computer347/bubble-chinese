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
export const PALETTES: readonly Palette[] = [
  { bg:'#2B37E0', ui:'#E6E8FF', dim:'rgba(230,232,255,.74)', line:'rgba(230,232,255,.34)', shadow:'rgba(8,10,80,.45)',  kind:'jelly',  mat:MATS.jelly('#FF86BC', '#FF3D8F') },
  { bg:'#FF6B2C', ui:'#2A0E02', dim:'rgba(42,14,2,.74)',     line:'rgba(42,14,2,.32)',     shadow:'rgba(120,30,0,.42)', kind:'chrome', mat:MATS.chrome() },
  { bg:'#B5C77A', ui:'#27300F', dim:'rgba(39,48,15,.76)',    line:'rgba(39,48,15,.32)',    shadow:'rgba(58,76,18,.4)',  kind:'mochi',  mat:MATS.mochi() },
  { bg:'#FF9EC7', ui:'#3A0A22', dim:'rgba(58,10,34,.76)',    line:'rgba(58,10,34,.32)',    shadow:'rgba(140,20,70,.35)',kind:'jelly',  mat:MATS.jelly('#4A5CFF', '#2B3BFF') },
  { bg:'#16786F', ui:'#E3FFF9', dim:'rgba(227,255,249,.76)', line:'rgba(227,255,249,.32)', shadow:'rgba(0,30,26,.5)',   kind:'jelly',  mat:MATS.jelly('#FFB22E', '#FF7A00') },
  { bg:'#3B1646', ui:'#F6E6FF', dim:'rgba(246,230,255,.74)', line:'rgba(246,230,255,.3)',  shadow:'rgba(10,0,14,.55)',  kind:'jelly',  mat:MATS.jelly('#C8F25A', '#7BD400') },
  { bg:'#FFD84D', ui:'#3A2A00', dim:'rgba(58,42,0,.76)',     line:'rgba(58,42,0,.32)',     shadow:'rgba(120,80,0,.35)', kind:'jelly',  mat:MATS.jelly('#E8342B', '#FF2A1A') },
  { bg:'#14213D', ui:'#EAF0FF', dim:'rgba(234,240,255,.74)', line:'rgba(234,240,255,.3)',  shadow:'rgba(0,0,10,.55)',   kind:'jelly',  mat:MATS.jelly('#FF6F59', '#FF3B22') },
  { bg:'#8EC5FF', ui:'#0B2545', dim:'rgba(11,37,69,.76)',    line:'rgba(11,37,69,.32)',    shadow:'rgba(20,60,120,.35)',kind:'mochi',  mat:MATS.mochi() },
  { bg:'#D9D9DB', ui:'#1E2B52', dim:'rgba(30,43,82,.74)',    line:'rgba(30,43,82,.3)',     shadow:'rgba(40,44,62,.36)', kind:'clay',   mat:MATS.clay() }
];
