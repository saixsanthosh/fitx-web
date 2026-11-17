import { test } from "node:test";
import assert from "node:assert/strict";
import type { FrameSize } from "@/components/form-coach/video-size";
import { videoSize, watchVideoSize } from "@/components/form-coach/video-size";

/** Stands in for a <video> showing a camera stream: the browser swaps the size and fires "resize". */
class CameraVideo extends EventTarget {
  videoWidth = 0;
  videoHeight = 0;

  show(width: number, height: number) {
    this.videoWidth = width;
    this.videoHeight = height;
    this.dispatchEvent(new Event("resize"));
  }
}

test("the picture size is unknown until the camera sends its first frame", () => {
  const video = new CameraVideo();
  assert.equal(videoSize(video), null);
  video.show(480, 640);
  assert.deepEqual(videoSize(video), { width: 480, height: 640 });
});

test("turning the phone mid-stream reports the new picture size, once per change", () => {
  const video = new CameraVideo();
  video.show(480, 640);
  const sizes: FrameSize[] = [];
  const stop = watchVideoSize(video, (size) => sizes.push(size));
  video.show(480, 640); // same size again: nothing to change
  video.show(640, 480); // turned sideways (auto-rotate on)
  video.show(0, 0); // the stream is being torn down
  video.show(480, 360); // a smaller picture asked for by the performance guard
  assert.deepEqual(sizes, [{ width: 640, height: 480 }, { width: 480, height: 360 }]);
  stop();
  video.show(360, 480);
  assert.equal(sizes.length, 2, "nothing is reported once the camera has stopped");
});
