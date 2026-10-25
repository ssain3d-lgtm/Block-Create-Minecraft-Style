import type { Vec3 } from "./coords";

export interface ProjectSettings {
  cellSize: number; // meters per cell
  bounds: { min: Vec3; max: Vec3 };
  seed: number;
}

export interface Region {
  id: string;
  name: string;
  level?: number;
  baseY?: number;
  height?: number;
}

export interface Building {
  id: string;
  name: string;
  origin: Vec3;
  regions: Region[];
}

export interface BlockEdit {
  op: "set" | "remove";
  at: Vec3;
  shape?: string;
  material?: string;
  rot?: number;
}

export interface Structure {
  id: string; // "s-12"
  num: number; // index stored in the world (never 0)
  name: string;
  type: string; // wall | roof | tower | truss | custom ...
  buildingId?: string;
  regionId?: string;
  key?: string; // plan key
  /** command that generated it: re-running this rebuilds the structure */
  source?: { cmd: string; args: unknown };
  /** hand edits kept across rebuilds */
  overrides: BlockEdit[];
  visible: boolean;
  locked: boolean;
  tags?: string[];
  /** cached anchor box (updated after build) */
  box?: { min: Vec3; max: Vec3 };
}

export interface MaterialDef {
  id: string;
  name: string;
  kind: "wood" | "stone" | "metal" | "glass" | "concrete" | "brick" | "tile" | "plant" | "water" | "custom";
  color: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissive?: string;
  pattern?: { type: "noise" | "grain" | "brick" | "tile" | "plank" | "grid" | "none"; scale?: number; contrast?: number };
  variants?: { count: number; lightness: number };
  tags?: string[];
  version?: number;
}

export type Recipe =
  | { type: "box"; min: Vec3; max: Vec3 }
  | { type: "extrude"; profile: [number, number][]; axis: "x" | "z"; from?: number; to?: number }
  | { type: "lathe"; profile: [number, number][]; segments?: number }
  | { type: "curve"; path: [number, number][]; thickness: number; axis?: "x" | "z"; from?: number; to?: number }
  | { type: "subvoxel"; size: number; mask: string[][] }
  | { type: "composite"; parts: { recipe: Recipe; offset?: Vec3; scale?: Vec3; yaw?: number }[] }
  | { type: "mesh"; positions: number[]; indices: number[] };

export type FaceName = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

export interface ShapeDef {
  id: string;
  name: string;
  recipe: Recipe;
  /** faces that completely cover the cell side (used for hidden face culling) */
  solidFaces: FaceName[];
  tags?: string[];
  description?: string;
  version?: number;
}

export interface ComponentDef {
  id: string;
  name: string;
  size: Vec3;
  blocks: { at: Vec3; shape: string; material: string; rot?: number }[];
  tags?: string[];
  version?: number;
}

export interface ProjectMeta {
  formatVersion: 1;
  name: string;
  title?: string;
  description?: string;
  tags: string[];
  settings: ProjectSettings;
  palette: { shapes: string[]; materials: string[] };
  buildings: Building[];
  structures: Structure[];
  /** copies of non-builtin assets used by this project (so it opens standalone) */
  assets: { shapes: ShapeDef[]; materials: MaterialDef[]; components: ComponentDef[] };
  counters: { structure: number; building: number; region: number };
}

export interface LogEntry {
  seq: number;
  cmd: string;
  args: unknown;
}
