function matches(predicate, value) {
  return typeof predicate === "function" ? predicate(value) : predicate.test(value);
}

export function matchAdded(snapshot, predicate) {
  return (snapshot.added ?? []).filter((line) => matches(predicate, line));
}

export function matchPaths(snapshot, predicate) {
  return (snapshot.changedPaths ?? []).filter((p) => matches(predicate, p));
}

export function result(value, hits = []) {
  return { value: Boolean(value), hits: hits.slice(0, 8) };
}
