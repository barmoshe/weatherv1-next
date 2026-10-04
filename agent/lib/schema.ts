// plan.json and picks.json: the two files the agent writes. Everything else is derived.
import { z } from "zod";

const T = z.number().nonnegative(); // an absolute time in seconds, anchored to a word start

export const IconSchema = z.enum([
  "sun", "cloud", "rain", "snow", "wind", "waves", "storm", "cold", "warm",
  "coat", "thermal", "tshirt", "longsleeve", "umbrella", "scarf", "run", "calendar", "mountain",
]);
export const ToneSchema = z.enum(["light", "coral", "orange", "teal", "blue"]).default("light");
const Chip = z.object({ text: z.string().min(1), at: T, tone: ToneSchema });
const Chips = z.array(Chip).max(4).default([]);

const SceneBase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "ids are lowercase-kebab"),
  start: T,
  end: T,
  /** Black overlay on the footage (0..0.6) so white text reads on bright shots. */
  dim: z.number().min(0).max(0.6).default(0.15),
  captions: z.boolean().default(true),
  /** What the background footage should show; drives `catalog search`. */
  bg: z.object({
    query: z.string().min(2),
    keywords: z.array(z.string()).default([]),
    mood: z.enum(["cheerful", "calm", "dramatic", "gloomy"]).optional(),
    concepts: z.record(z.array(z.string())).optional(),
    treatment: z.enum(["clean", "dim", "blur"]).default("clean"),
  }),
});

export const SceneSchema = z.discriminatedUnion("type", [
  SceneBase.extend({ type: z.literal("intro"), data: z.object({
    title: z.string().default("תחזית"), headline: z.string().optional(), headline_at: T.optional(), icon: IconSchema.default("sun"),
  }) }),
  SceneBase.extend({ type: z.literal("text"), data: z.object({
    kicker: z.string().optional(), kicker_at: T.optional(), headline: z.string(), headline_at: T,
    sub: z.string().optional(), sub_at: T.optional(), icon: IconSchema.optional(), icon_at: T.optional(), chips: Chips,
  }) }),
  SceneBase.extend({ type: z.literal("alert"), data: z.object({
    icon: IconSchema, kicker: z.string().optional(), headline: z.string(), headline_at: T,
    value: z.string().optional(), value_at: T.optional(), chips: Chips,
  }) }),
  SceneBase.extend({ type: z.literal("trend"), data: z.object({
    direction: z.enum(["up", "down"]), headline: z.string(), headline_at: T, sub: z.string().optional(), sub_at: T.optional(), chips: Chips,
  }) }),
  SceneBase.extend({ type: z.literal("sea"), data: z.object({
    headline: z.string(), headline_at: T, state: z.string(), state_at: T,
    wave: z.string().optional(), wave_at: T.optional(), chips: Chips,
  }) }),
  SceneBase.extend({ type: z.literal("clothing"), data: z.object({
    kicker: z.string().default("מה ללבוש היום?"), kicker_at: T.optional(),
    items: z.array(z.object({ icon: IconSchema, label: z.string(), note: z.string().optional(), at: T })).min(1).max(3),
    chips: Chips,
  }) }),
  SceneBase.extend({ type: z.literal("cities"), data: z.object({
    header: z.string(), header_at: T,
    cities: z.array(z.object({ name: z.string(), key: z.string().optional(), temp: z.number(), note: z.string().optional(), at: T })).min(1).max(8),
  }) }),
  SceneBase.extend({ type: z.literal("event"), data: z.object({
    kicker: z.string().optional(), kicker_at: T.optional(), headline: z.string(), headline_at: T,
    sub: z.string().optional(), sub_at: T.optional(), icon: IconSchema.optional(),
    stat: z.object({ value: z.number(), label: z.string(), at: T }).optional(), chips: Chips,
  }) }),
  SceneBase.extend({ type: z.literal("days"), data: z.object({
    header: z.string().optional(), header_at: T.optional(),
    days: z.array(z.object({ label: z.string(), icon: IconSchema, note: z.string(), at: T })).min(1).max(3),
    chips: Chips,
  }) }),
  SceneBase.extend({ type: z.literal("outro"), data: z.object({ line: z.string().default("מזג האוויר, בקצב של V1") }) }),
]);

export const PlanSchema = z.object({
  date_label: z.string().nullable(),
  duration: z.number().positive(),
  /** Seconds of music-only tail after the narration ends (the outro). */
  tail: z.number().min(0).max(6).default(3),
  scenes: z.array(SceneSchema).min(2),
  captions: z.array(z.object({ start: T, end: T, text: z.string().min(1).max(34) })),
  unresolved: z.array(z.object({ heard: z.string(), at: T, note: z.string() })).default([]),
});
export type Plan = z.infer<typeof PlanSchema>;
export type PlanScene = z.infer<typeof SceneSchema>;

export const PickSchema = z.object({ segment_id: z.string(), in: z.number().nonnegative().optional() });
export const PicksSchema = z.object({
  scenes: z.record(z.array(PickSchema).min(1).max(3)),
  /** Optional still for a city card: city key -> catalog segment id showing that place. */
  cities: z.record(z.string()).default({}),
});
export type Picks = z.infer<typeof PicksSchema>;

export const WordsSchema = z.object({
  text: z.string(),
  words: z.array(z.object({ w: z.string(), start: z.number(), end: z.number(), unresolved: z.boolean().optional() })),
});
export type Words = z.infer<typeof WordsSchema>;

/** Every `*_at` / `at` value inside a scene's data, with a label for error messages. */
export function sceneCues(s: PlanScene): Array<{ label: string; at: number }> {
  const out: Array<{ label: string; at: number }> = [];
  const walk = (v: unknown, label: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${label}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if ((k === "at" || k.endsWith("_at")) && typeof x === "number") out.push({ label: `${label}.${k}`, at: x });
        else walk(x, `${label}.${k}`);
      }
  };
  walk(s.data, `${s.id}.data`);
  return out;
}
