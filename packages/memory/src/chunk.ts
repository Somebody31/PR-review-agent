export type TextChunk = {
  chunkIndex: number;
  content: string;
};

/**
 * Split file text into overlapping line windows for embedding.
 */
export function chunkTextByLines(
  text: string,
  windowLines: number = 100,
  overlapLines: number = 20,
): TextChunk[] {
  const lines = text.split("\n");
  const chunks: TextChunk[] = [];
  const step = Math.max(1, windowLines - overlapLines);
  let start = 0;
  let index = 0;

  while (start < lines.length) {
    const end = Math.min(lines.length, start + windowLines);
    const slice = lines.slice(start, end);
    chunks.push({
      chunkIndex: index,
      content: slice.join("\n"),
    });
    index += 1;
    if (end >= lines.length) {
      break;
    }
    start += step;
  }

  return chunks;
}
