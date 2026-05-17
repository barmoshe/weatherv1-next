import type { TileState } from "./StudioPanel";

export const STATUS_LABELS: Record<TileState, string> = {
  "is-skeleton": "ממתין",
  waiting: "בתור",
  active: "מעבד",
  completed: "הושלם",
  failed: "נכשל",
};
