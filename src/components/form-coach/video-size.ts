/**
 * The camera picture's size, followed while the camera runs. It changes mid-stream when the phone
 * turns (with auto-rotate on, the browser swaps the frame's width and height) or when the camera is
 * asked for a smaller picture. The live view sizes its box from it, so a stale size would crop the
 * picture and pull the skeleton off the body.
 */

export interface FrameSize {
  width: number;
  height: number;
}

/** What is read from a <video>: its picture size and its "resize" event. */
export interface SizedVideo extends EventTarget {
  readonly videoWidth: number;
  readonly videoHeight: number;
}

/** The picture size, or null while the video has none yet. */
export function videoSize(video: SizedVideo): FrameSize | null {
  return video.videoWidth > 0 && video.videoHeight > 0 ? { width: video.videoWidth, height: video.videoHeight } : null;
}

/** Calls `onChange` with each new picture size until the returned function is called. */
export function watchVideoSize(video: SizedVideo, onChange: (size: FrameSize) => void): () => void {
  let last = videoSize(video);
  const onResize = () => {
    const size = videoSize(video);
    if (!size || (last && size.width === last.width && size.height === last.height)) return;
    last = size;
    onChange(size);
  };
  video.addEventListener("resize", onResize);
  return () => video.removeEventListener("resize", onResize);
}
