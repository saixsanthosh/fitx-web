import "server-only";

/**
 * Reads a text/event-stream body and yields each event's data. Comment lines (": keep-alive",
 * OpenRouter's ": OPENROUTER PROCESSING") and other fields are skipped. Multi-line data is joined
 * with "\n", as the SSE spec says.
 */
export async function* readSseData(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.search(/\r\n|\n|\r/)) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));
        if (line === "") {
          if (data.length) yield data.join("\n");
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
        }
      }
      if (done) break;
    }
    if (buffer.startsWith("data:")) data.push(buffer.slice(buffer.startsWith("data: ") ? 6 : 5));
    if (data.length) yield data.join("\n");
  } finally {
    reader.releaseLock();
    // Stop the download if the caller stopped early (an error or an abort).
    body.cancel().catch(() => {});
  }
}
