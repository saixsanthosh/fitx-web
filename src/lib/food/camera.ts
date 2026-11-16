/**
 * Opening the camera for the barcode scanner without ever leaving it on. Starting the camera takes a moment (and
 * the permission prompt can take longer), so the scanner may be closed before the camera is ready: a stream that
 * arrives after that is stopped at once. Kept apart from the component so the tests can run it.
 */
export async function openCamera(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  constraints: MediaStreamConstraints,
  closed: () => boolean,
): Promise<MediaStream | null> {
  if (closed()) return null;
  const media = await getUserMedia(constraints);
  if (closed()) {
    stopCamera(media);
    return null;
  }
  return media;
}

/** Turns the camera off: every track of the stream, so the browser's camera indicator goes out. */
export function stopCamera(media: MediaStream | null | undefined) {
  media?.getTracks().forEach((track) => track.stop());
}
