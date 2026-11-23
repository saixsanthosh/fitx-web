/**
 * BlazePose body landmarks as MediaPipe Pose Landmarker returns them: 33 points with x and y
 * normalised to the image (0..1, x to the right, y down), plus visibility and presence scores.
 * Everything here is plain data so the rule engine and its tests run without a browser.
 */

/** One landmark. `visibility`: likely visible (not hidden behind the body); `presence`: inside the image. */
export interface PosePoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

/** One analysed camera frame. */
export interface PoseFrame {
  /** Milliseconds on a monotonic clock (performance.now() or the video frame time). */
  t: number;
  /** The 33 landmarks of the person in view, or null when no person was found. */
  points: readonly PosePoint[] | null;
  /** Image width divided by height, so angles are measured in square pixels. */
  aspect: number;
  /**
   * The same 33 landmarks in metres, centred between the hips (MediaPipe's world landmarks), when the
   * model gives them. Joint angles measured here do not shrink when the body is turned away from the
   * camera, so oblique views and leaning towards the lens can still be judged.
   */
  world?: readonly PosePoint[] | null;
}

export type Side = "left" | "right";

/** The body joints the form rules use. Each has a left and a right landmark. */
export type Joint = "ear" | "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle" | "heel" | "foot";

export const LANDMARK_COUNT = 33;

export const LANDMARK = {
  nose: 0,
  leftEyeInner: 1, leftEye: 2, leftEyeOuter: 3, rightEyeInner: 4, rightEye: 5, rightEyeOuter: 6,
  leftEar: 7, rightEar: 8, mouthLeft: 9, mouthRight: 10,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftPinky: 17, rightPinky: 18, leftIndex: 19, rightIndex: 20, leftThumb: 21, rightThumb: 22,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30, leftFootIndex: 31, rightFootIndex: 32,
} as const;

const JOINT_INDEX: Record<Joint, readonly [left: number, right: number]> = {
  ear: [LANDMARK.leftEar, LANDMARK.rightEar],
  shoulder: [LANDMARK.leftShoulder, LANDMARK.rightShoulder],
  elbow: [LANDMARK.leftElbow, LANDMARK.rightElbow],
  wrist: [LANDMARK.leftWrist, LANDMARK.rightWrist],
  hip: [LANDMARK.leftHip, LANDMARK.rightHip],
  knee: [LANDMARK.leftKnee, LANDMARK.rightKnee],
  ankle: [LANDMARK.leftAnkle, LANDMARK.rightAnkle],
  heel: [LANDMARK.leftHeel, LANDMARK.rightHeel],
  foot: [LANDMARK.leftFootIndex, LANDMARK.rightFootIndex],
};

export function landmarkIndex(joint: Joint, side: Side): number {
  return JOINT_INDEX[joint][side === "left" ? 0 : 1];
}

/** Body lines drawn over the video. Face and finger points are left out to keep the overlay calm. */
export const SKELETON_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [LANDMARK.leftShoulder, LANDMARK.rightShoulder],
  [LANDMARK.leftShoulder, LANDMARK.leftElbow], [LANDMARK.leftElbow, LANDMARK.leftWrist],
  [LANDMARK.rightShoulder, LANDMARK.rightElbow], [LANDMARK.rightElbow, LANDMARK.rightWrist],
  [LANDMARK.leftShoulder, LANDMARK.leftHip], [LANDMARK.rightShoulder, LANDMARK.rightHip],
  [LANDMARK.leftHip, LANDMARK.rightHip],
  [LANDMARK.leftHip, LANDMARK.leftKnee], [LANDMARK.leftKnee, LANDMARK.leftAnkle],
  [LANDMARK.rightHip, LANDMARK.rightKnee], [LANDMARK.rightKnee, LANDMARK.rightAnkle],
  [LANDMARK.leftAnkle, LANDMARK.leftHeel], [LANDMARK.leftHeel, LANDMARK.leftFootIndex], [LANDMARK.leftAnkle, LANDMARK.leftFootIndex],
  [LANDMARK.rightAnkle, LANDMARK.rightHeel], [LANDMARK.rightHeel, LANDMARK.rightFootIndex], [LANDMARK.rightAnkle, LANDMARK.rightFootIndex],
];

/** Landmarks drawn as joints (body only). */
export const SKELETON_JOINTS: readonly number[] = [
  LANDMARK.nose,
  ...[LANDMARK.leftShoulder, LANDMARK.rightShoulder, LANDMARK.leftElbow, LANDMARK.rightElbow, LANDMARK.leftWrist, LANDMARK.rightWrist],
  ...[LANDMARK.leftHip, LANDMARK.rightHip, LANDMARK.leftKnee, LANDMARK.rightKnee, LANDMARK.leftAnkle, LANDMARK.rightAnkle],
  ...[LANDMARK.leftHeel, LANDMARK.rightHeel, LANDMARK.leftFootIndex, LANDMARK.rightFootIndex],
];

/** Default confidence a landmark needs before a rule may use it. */
export const MIN_VISIBILITY = 0.6;
/** How far outside the image (in image fractions) a landmark may sit and still count as seen. */
const FRAME_MARGIN = 0.02;

/** True when a landmark is confidently seen inside the image. */
export function isConfident(point: PosePoint | undefined, minVisibility = MIN_VISIBILITY): point is PosePoint {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if ((point.visibility ?? 1) < minVisibility) return false;
  if ((point.presence ?? 1) < minVisibility) return false;
  return point.x >= -FRAME_MARGIN && point.x <= 1 + FRAME_MARGIN && point.y >= -FRAME_MARGIN && point.y <= 1 + FRAME_MARGIN;
}
