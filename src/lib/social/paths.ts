/** Storage paths in the social-media bucket, as its policies expect them. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type PhotoType = "image/webp" | "image/jpeg";
export const extensionFor = (type: PhotoType) => (type === "image/webp" ? "webp" : "jpg");

/** <user id>/<post id>/<position>.<ext>, position 0 to 9. */
export function postPhotoPath(userId: string, postId: string, position: number, type: PhotoType): string {
  if (!UUID.test(userId) || !UUID.test(postId) || !Number.isInteger(position) || position < 0 || position > 9) {
    throw new Error("Invalid photo path");
  }
  return `${userId}/${postId}/${position}.${extensionFor(type)}`;
}

/** <user id>/profile/<stamp>.<ext>: a new name each time, so a cached old picture never shows. */
export function avatarPath(userId: string, type: PhotoType, stamp: number = Date.now()): string {
  if (!UUID.test(userId)) throw new Error("Invalid photo path");
  return `${userId}/profile/a-${Math.max(0, Math.floor(stamp)).toString(36)}.${extensionFor(type)}`;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
