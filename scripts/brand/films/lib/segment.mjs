/**
 * The ffmpeg filter that turns the lab's frames into one FFV1 shot segment (render.mjs). Pure, so the frame
 * arithmetic is testable on its own.
 *
 * With sub-frames, the lab sends `subframes` samples per output frame, so ffmpeg reads them at `fps × subframes`.
 * `tmix` averages each run of samples (motion blur), `select` keeps the frame that closes each run, and `setpts`
 * places the kept frames on the OUTPUT clock (`fps`). Retiming them on the filter graph's own FRAME_RATE (the input's
 * `fps × subframes`) spaced them 1/(fps × subframes) apart, so the encoder's `-r fps` then dropped every other one:
 * S6's first intro masters came out at 402 of 756 frames that way.
 *
 * @param {{ outWidth: number, outHeight: number, fps: number, subframes: number, flip: boolean }} options
 * @returns {string}
 */
export function segmentFilter({ outWidth, outHeight, fps, subframes, flip }) {
  if (!Number.isInteger(fps) || fps < 1) throw new Error("segmentFilter needs the output fps");
  if (!Number.isInteger(subframes) || subframes < 1) throw new Error("segmentFilter needs a whole number of sub-frames");
  const parts = [];
  if (flip) parts.push("vflip");
  if (subframes > 1) {
    parts.push(`tmix=frames=${subframes}`, `select='eq(mod(n\\,${subframes})\\,${subframes - 1})'`, `setpts=N/(${fps}*TB)`);
  }
  parts.push(
    `scale=${outWidth}:${outHeight}:flags=lanczos:out_color_matrix=bt709:out_range=tv`,
    "format=yuv444p10le",
    "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
  );
  return parts.join(",");
}
