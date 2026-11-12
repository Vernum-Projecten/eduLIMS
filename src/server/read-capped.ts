// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Reading an HTTP answer from an outside service with a size limit, so a misbehaving or hostile
// service cannot make the server buffer an unbounded body.
import "@tanstack/react-start/server-only";

/**
 * Reads at most `limit` bytes of a body as UTF-8 text.
 *
 * @returns The text, `""` for no body, or `undefined` when the body is larger than `limit`
 * (the rest of the stream is cancelled).
 */
export async function readCapped(response: Response, limit: number): Promise<string | undefined> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
