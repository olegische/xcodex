export function normalizeHostValue(value: unknown): unknown {
  return normalizeHostValueInternal(value, true);
}

export function normalizeHostValuePreservingStrings(value: unknown): unknown {
  return normalizeHostValueInternal(value, false);
}

function normalizeHostValueInternal(value: unknown, parseStrings: boolean): unknown {
  if (typeof value === "string") {
    if (parseStrings) {
      try {
        return normalizeHostValueInternal(JSON.parse(value), parseStrings);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeHostValueInternal(item, parseStrings));
  }
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, nested]) => [
        key,
        normalizeHostValueInternal(nested, parseStrings),
      ]),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        normalizeHostValueInternal(nested, parseStrings),
      ]),
    );
  }
  return value;
}
