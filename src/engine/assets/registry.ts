import type { ComponentDef, MaterialDef, ShapeDef } from "../types";
import { BUILTIN_ALIASES, BUILTIN_MATERIALS, BUILTIN_SHAPES } from "./builtin";

export type AssetKind = "shape" | "material" | "component";
export type AnyAsset = ShapeDef | MaterialDef | ComponentDef;

export interface AssetStore {
  /** persistent shared library (library/ folder in Node, localStorage in the browser) */
  load(): { shapes: ShapeDef[]; materials: MaterialDef[]; components: ComponentDef[] };
  save(kind: AssetKind, def: AnyAsset): void;
  /** optional: used to roll back a library change */
  remove?(kind: AssetKind, id: string): void;
  read?(kind: AssetKind, id: string): AnyAsset | undefined;
}

/**
 * Lookup order: builtin -> project copies -> shared library.
 * Short ids ("stone", "cube") resolve to builtin.* for convenience.
 */
export class AssetRegistry {
  private builtinShapes = new Map(BUILTIN_SHAPES.map((d) => [d.id, d]));
  private builtinMaterials = new Map(BUILTIN_MATERIALS.map((d) => [d.id, d]));
  libShapes = new Map<string, ShapeDef>();
  libMaterials = new Map<string, MaterialDef>();
  libComponents = new Map<string, ComponentDef>();

  constructor(public store?: AssetStore) {
    this.reloadLibrary();
  }

  reloadLibrary() {
    if (!this.store) return;
    try {
      const lib = this.store.load();
      for (const d of lib.shapes) this.libShapes.set(d.id, d);
      for (const d of lib.materials) this.libMaterials.set(d.id, d);
      for (const d of lib.components) this.libComponents.set(d.id, d);
    } catch {
      /* library is optional */
    }
  }

  normalizeId(id: string): string {
    if (BUILTIN_ALIASES[id]) return BUILTIN_ALIASES[id];
    return id.includes(".") ? id : `builtin.${id}`;
  }

  builtinShapes_() { return [...this.builtinShapes.values()].filter((d) => !d.internal); }
  builtinMaterials_() { return [...this.builtinMaterials.values()]; }

  isBuiltin(id: string) {
    return id.startsWith("builtin.");
  }

  findShape(id: string, project?: ShapeDef[]): ShapeDef | undefined {
    const n = this.normalizeId(id);
    return this.builtinShapes.get(n) ?? project?.find((d) => d.id === n) ?? this.libShapes.get(n);
  }

  findMaterial(id: string, project?: MaterialDef[]): MaterialDef | undefined {
    const n = this.normalizeId(id);
    return this.builtinMaterials.get(n) ?? project?.find((d) => d.id === n) ?? this.libMaterials.get(n);
  }

  findComponent(id: string, project?: ComponentDef[]): ComponentDef | undefined {
    return project?.find((d) => d.id === id) ?? this.libComponents.get(id);
  }

  allShapes(project: ShapeDef[] = []): ShapeDef[] {
    const map = new Map<string, ShapeDef>();
    for (const d of this.builtinShapes.values()) if (!d.internal) map.set(d.id, d);
    for (const d of this.libShapes.values()) map.set(d.id, d);
    for (const d of project) map.set(d.id, d);
    return [...map.values()];
  }

  allMaterials(project: MaterialDef[] = []): MaterialDef[] {
    const map = new Map<string, MaterialDef>();
    for (const d of this.builtinMaterials.values()) map.set(d.id, d);
    for (const d of this.libMaterials.values()) map.set(d.id, d);
    for (const d of project) map.set(d.id, d);
    return [...map.values()];
  }

  allComponents(project: ComponentDef[] = []): ComponentDef[] {
    const map = new Map<string, ComponentDef>();
    for (const d of this.libComponents.values()) map.set(d.id, d);
    for (const d of project) map.set(d.id, d);
    return [...map.values()];
  }

  /** Registers into the shared library (persists when a store exists). */
  register(kind: AssetKind, def: AnyAsset) {
    if (this.isBuiltin(def.id)) throw new Error("builtin.* assets are read-only");
    if (kind === "shape") this.libShapes.set(def.id, def as ShapeDef);
    else if (kind === "material") this.libMaterials.set(def.id, def as MaterialDef);
    else this.libComponents.set(def.id, def as ComponentDef);
    this.store?.save(kind, def);
  }

  libraryGet(kind: AssetKind, id: string): AnyAsset | undefined {
    const m = kind === "shape" ? this.libShapes : kind === "material" ? this.libMaterials : this.libComponents;
    const d = m.get(id);
    return d ? structuredClone(d) : undefined;
  }

  /** Undo a register(): put back the previous definition, or remove the new one. */
  restore(kind: AssetKind, id: string, prev: AnyAsset | undefined) {
    const m = (kind === "shape" ? this.libShapes : kind === "material" ? this.libMaterials : this.libComponents) as Map<string, AnyAsset>;
    if (prev) {
      m.set(id, prev);
      this.store?.save(kind, prev);
    } else {
      m.delete(id);
      this.store?.remove?.(kind, id);
    }
  }

  search(q: { text?: string; tags?: string[]; kind?: AssetKind }, project?: { shapes: ShapeDef[]; materials: MaterialDef[]; components: ComponentDef[] }) {
    const pools: { kind: AssetKind; items: AnyAsset[] }[] = [];
    if (!q.kind || q.kind === "shape") pools.push({ kind: "shape", items: this.allShapes(project?.shapes) });
    if (!q.kind || q.kind === "material") pools.push({ kind: "material", items: this.allMaterials(project?.materials) });
    if (!q.kind || q.kind === "component") pools.push({ kind: "component", items: this.allComponents(project?.components) });
    const text = q.text?.toLowerCase();
    const out: { kind: AssetKind; id: string; name: string; tags: string[]; score: number; description?: string }[] = [];
    for (const p of pools) {
      for (const d of p.items) {
        const tags = d.tags ?? [];
        let score = 0;
        if (q.tags?.length) {
          const hit = q.tags.filter((t) => tags.includes(t) || d.id.includes(t)).length;
          if (!hit) continue;
          score += hit * 2;
        }
        if (text) {
          const hay = `${d.id} ${d.name} ${tags.join(" ")} ${(d as ShapeDef).description ?? ""}`.toLowerCase();
          const words = text.split(/\s+/).filter(Boolean);
          const hit = words.filter((w) => hay.includes(w)).length;
          if (!hit) continue;
          score += hit;
        }
        out.push({ kind: p.kind, id: d.id, name: d.name, tags, score, description: (d as ShapeDef).description });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }
}
