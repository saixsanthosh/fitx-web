import { test } from "node:test";
import assert from "node:assert/strict";
import { openCamera, stopCamera } from "@/lib/food/camera";

/** A fake camera stream whose tracks record being stopped. */
function fakeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }, { stopped: false, stop() { this.stopped = true; } }];
  return { tracks, stream: { getTracks: () => tracks } as unknown as MediaStream };
}

test("a camera that starts after the scanner was closed is turned off at once", async () => {
  const { tracks, stream } = fakeStream();
  let closed = false;
  let resolveCamera: (media: MediaStream) => void = () => {};
  const starting = openCamera(() => new Promise<MediaStream>((resolve) => { resolveCamera = resolve; }), { video: true }, () => closed);
  closed = true; // the user taps X while "Starting the camera…"
  resolveCamera(stream);
  assert.equal(await starting, null);
  assert.deepEqual(tracks.map((track) => track.stopped), [true, true]);
});

test("the camera is not asked for at all once the scanner is closed", async () => {
  let asked = 0;
  const media = await openCamera(async () => { asked += 1; return fakeStream().stream; }, { video: true }, () => true);
  assert.equal(media, null);
  assert.equal(asked, 0);
});

test("an open scanner gets the stream, and stopping it stops every track", async () => {
  const { tracks, stream } = fakeStream();
  assert.equal(await openCamera(async () => stream, { video: true }, () => false), stream);
  assert.deepEqual(tracks.map((track) => track.stopped), [false, false]);
  stopCamera(stream);
  stopCamera(null);
  assert.deepEqual(tracks.map((track) => track.stopped), [true, true]);
});
