import type {RoofEdgeKind} from "@/domain/roof-drawing";

export const edgeKindColors: Record<RoofEdgeKind, string> = {
  eave: "#16a34a",
  rake: "#2563eb",
  ridge: "#dc2626",
  hip: "#9333ea",
  valley: "#ea580c",
  step_flashing: "#ca8a04",
  wall_flashing: "#0891b2",
  transition: "#db2777",
};
