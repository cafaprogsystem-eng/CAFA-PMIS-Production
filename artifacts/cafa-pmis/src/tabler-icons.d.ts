// Types for per-icon Tabler imports (see src/components/icons.ts). The package
// only types its root barrel, which we avoid so Vite doesn't pre-bundle every
// icon in dev.
declare module "@tabler/icons-react/dist/esm/icons/*.mjs" {
  import type { TablerIcon } from "@tabler/icons-react";
  const icon: TablerIcon;
  export default icon;
}
