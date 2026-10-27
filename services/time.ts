/** Local writes in the same millisecond still need an unambiguous order. */
let lastWrite = 0;
export function nextTimestamp(): string {
  lastWrite = Math.max(Date.now(), lastWrite + 1);
  return new Date(lastWrite).toISOString();
}
