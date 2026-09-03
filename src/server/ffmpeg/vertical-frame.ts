/**
 * Shared 9:16 vertical frame contract used by both the renderer and the
 * Premiere export bundle. Centralising it keeps the rendered MP4 and the
 * bundled clips frame-identical — drift here is what produced the v0.4.5
 * "letterboxed band in Premiere" regression.
 *
 * The filter is cover-crop: `force_original_aspect_ratio=increase` scales the
 * input up until both dimensions are ≥ the target, then `crop` trims to exactly
 * 1080×1920. `setsar=1` pins square pixels so downstream tools don't conform.
 */

export const VERTICAL_FRAME_WIDTH = 1080;
export const VERTICAL_FRAME_HEIGHT = 1920;

export const VERTICAL_SCALE_CROP_FILTER = [
  `scale=${VERTICAL_FRAME_WIDTH}:${VERTICAL_FRAME_HEIGHT}:force_original_aspect_ratio=increase`,
  `crop=${VERTICAL_FRAME_WIDTH}:${VERTICAL_FRAME_HEIGHT}`,
  "setsar=1",
].join(",");
