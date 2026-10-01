import type { BodyId } from './data.ts';

// Layers inside each body for the cut-away view, surface first: the outer edge of each layer as a
// fraction of the radius and its colour. Proportions follow real models, except that thin crusts are
// drawn thicker so a child can see them. Names and narration for each layer id are in texts.yaml.

export interface LayerPhysics {
  /** matches bodies.<id>.inside.layers.<id> in texts.yaml */
  id: string;
  /** outer edge, fraction of the radius */
  to: number;
  color: string;
}

export const LAYERS: Partial<Record<BodyId, LayerPhysics[]>> = {
  sun: [
    { id: 'convection', to: 1, color: '#ff8a2a' },
    { id: 'radiation', to: 0.7, color: '#ffc04a' },
    { id: 'core', to: 0.25, color: '#fff6c8' },
  ],
  mercury: [
    { id: 'crust', to: 1, color: '#9a6a3c' },
    { id: 'mantle', to: 0.95, color: '#d9622b' },
    { id: 'core', to: 0.83, color: '#f0c060' },
  ],
  venus: [
    { id: 'crust', to: 1, color: '#9a6a3c' },
    { id: 'mantle', to: 0.95, color: '#d9622b' },
    { id: 'core', to: 0.5, color: '#f0c060' },
  ],
  earth: [
    { id: 'crust', to: 1, color: '#9a6a3c' },
    { id: 'mantle', to: 0.95, color: '#d9622b' },
    { id: 'outer_core', to: 0.55, color: '#f2a33a' },
    { id: 'inner_core', to: 0.19, color: '#fff0a6' },
  ],
  moon: [
    { id: 'crust', to: 1, color: '#a8a39a' },
    { id: 'mantle', to: 0.94, color: '#c0703c' },
    { id: 'core', to: 0.2, color: '#f0c060' },
  ],
  mars: [
    { id: 'crust', to: 1, color: '#b0532c' },
    { id: 'mantle', to: 0.94, color: '#d9622b' },
    { id: 'core', to: 0.53, color: '#f0c060' },
  ],
  jupiter: [
    { id: 'clouds', to: 1, color: '#e2c49a' },
    { id: 'liquid_hydrogen', to: 0.96, color: '#8db4dc' },
    { id: 'metallic_hydrogen', to: 0.78, color: '#5a78b8' },
    { id: 'core', to: 0.2, color: '#b9784c' },
  ],
  saturn: [
    { id: 'clouds', to: 1, color: '#ead6a8' },
    { id: 'liquid_hydrogen', to: 0.96, color: '#8db4dc' },
    { id: 'metallic_hydrogen', to: 0.5, color: '#5a78b8' },
    { id: 'core', to: 0.22, color: '#b9784c' },
  ],
  uranus: [
    { id: 'atmosphere', to: 1, color: '#a8e0ea' },
    { id: 'mantle', to: 0.75, color: '#4b9cc4' },
    { id: 'core', to: 0.2, color: '#b9784c' },
  ],
  neptune: [
    { id: 'atmosphere', to: 1, color: '#6f9be8' },
    { id: 'mantle', to: 0.8, color: '#3c68b0' },
    { id: 'core', to: 0.25, color: '#b9784c' },
  ],
  pluto: [
    { id: 'crust', to: 1, color: '#e6ddd2' },
    { id: 'ocean', to: 0.86, color: '#4f8fd0' },
    { id: 'core', to: 0.72, color: '#b9784c' },
  ],
  charon: [
    { id: 'crust', to: 1, color: '#d6dbe0' },
    { id: 'core', to: 0.7, color: '#b9784c' },
  ],
  io: [
    { id: 'crust', to: 1, color: '#d9b54a' },
    { id: 'mantle', to: 0.9, color: '#e0662b' },
    { id: 'core', to: 0.52, color: '#f0c060' },
  ],
  europa: [
    { id: 'crust', to: 1, color: '#eef3f7' }, // ice shell (really thinner: ~20 km of 1560)
    { id: 'ocean', to: 0.92, color: '#3f7fd0' },
    { id: 'mantle', to: 0.84, color: '#a8724a' },
    { id: 'core', to: 0.42, color: '#f0c060' },
  ],
  ganymede: [
    { id: 'crust', to: 1, color: '#dfe6ec' },
    { id: 'ocean', to: 0.9, color: '#3f7fd0' },
    { id: 'mantle', to: 0.8, color: '#8d7a68' },
    { id: 'core', to: 0.3, color: '#f0c060' },
  ],
  callisto: [
    { id: 'crust', to: 1, color: '#7d6e60' },
    { id: 'ocean', to: 0.93, color: '#3f7fd0' },
    { id: 'mantle', to: 0.86, color: '#9a8f86' },
  ],
  titan: [
    { id: 'crust', to: 1, color: '#d9a45a' },
    { id: 'ocean', to: 0.9, color: '#3f7fd0' },
    { id: 'mantle', to: 0.8, color: '#c9dfea' },
    { id: 'core', to: 0.6, color: '#9a7a5a' },
  ],
  enceladus: [
    { id: 'crust', to: 1, color: '#f4f8fb' },
    { id: 'ocean', to: 0.9, color: '#3f7fd0' },
    { id: 'core', to: 0.75, color: '#8a7a6a' },
  ],
  triton: [
    { id: 'crust', to: 1, color: '#e9d8d0' },
    { id: 'mantle', to: 0.85, color: '#bcd3e0' },
    { id: 'core', to: 0.65, color: '#9a7a5a' },
  ],
};
