// Money read back from SQLite (docs/00-backlog, reported 2026-08-12): the
// web driver once returned INTEGER columns as `bigint`, and mixing a bigint
// with a plain number throws ("Cannot mix BigInt and other types"). It
// returns `number` today (checked 2026-10-09 on @powersync/web 2.3.0), but
// the native drivers can't be checked here and a future SDK could change
// again, so store.tsx's row mappers convert once, here, rather than every
// sum and comparison downstream having to care.
export function centsFromRow(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}
