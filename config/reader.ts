import type { MarkingColor } from "../lib/markings";

/** Deployment defaults. Existing users keep their locally customized list. */
export const DEPLOYMENT_MARKING_COLORS: MarkingColor[] = [
  { id: "yellow", name: "Promises", value: "#fde68a" },
  { id: "green", name: "Growth", value: "#bbf7d0" },
  { id: "blue", name: "Study", value: "#bfdbfe" },
  { id: "pink", name: "Prayer", value: "#fbcfe8" },
];
