/**
 * Character generation worker (worker-safe: no `three`, no DOM). OWNER: character-body.
 *
 * Protocol:
 *   in:  { type: "generate", id }
 *   out: { type: "result", id, data }   every typed array is transferred (zero-copy)
 *        { type: "error", id, message }
 */

import { CAST } from "./cast";
import { generateCharacter } from "./generate";
import type { CharacterId, CharacterMeshData } from "./types";

export type CharacterWorkerRequest = { type: "generate"; id: CharacterId };
export type CharacterWorkerResponse =
  | { type: "result"; id: CharacterId; data: CharacterMeshData }
  | { type: "error"; id: CharacterId; message: string };

/** Every ArrayBuffer referenced by the mesh data (deduplicated). Not exported: importing this
 * module anywhere else would install the message handler on that thread. */
function characterTransferables(data: CharacterMeshData): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const addArray = (array: ArrayBufferView | undefined) => {
    if (array && array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
  };
  addArray(data.bind.positions);
  addArray(data.bind.parents);
  for (const part of data.parts) {
    addArray(part.positions);
    addArray(part.normals);
    addArray(part.colors);
    addArray(part.indices);
    addArray(part.skinIndex);
    addArray(part.skinWeight);
    addArray(part.detail);
    for (const morph of part.morphs ?? []) {
      addArray(morph.positions);
      addArray(morph.normals);
      addArray(morph.colors);
    }
  }
  return [...buffers];
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<CharacterWorkerRequest>) => void) | null;
  postMessage(message: CharacterWorkerResponse, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  if (!request || request.type !== "generate") return;
  const { id } = request;
  try {
    const spec = CAST[id];
    if (!spec) throw new Error(`unknown character "${String(id)}"`);
    const data = generateCharacter(spec);
    scope.postMessage({ type: "result", id, data }, characterTransferables(data));
  } catch (error) {
    scope.postMessage({ type: "error", id, message: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) }, []);
  }
};
