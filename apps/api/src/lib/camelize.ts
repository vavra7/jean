export function camelizeKeys<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

export function camelizeRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => camelizeKeys(row));
}
