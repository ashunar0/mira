export type ObjectTree = { [key: string]: unknown };

export function isPlainObject(value: unknown): value is ObjectTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 後ろの値を優先して重ねる。どちらも object の所だけ中まで重ね、配列は丸ごと置き換える */
export function deepMerge(base: ObjectTree, override: ObjectTree): ObjectTree {
  const merged: ObjectTree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return merged;
}

/**
 * previous にあって next にない値を undefined にして足す。差分だけを受け取る相手（Monaco の updateOptions）に、
 * 消えた値を既定に戻してもらうため
 */
export function withResets(previous: ObjectTree, next: ObjectTree): ObjectTree {
  const result: ObjectTree = { ...next };
  for (const [key, value] of Object.entries(previous)) {
    if (!(key in next)) result[key] = undefined;
    else if (isPlainObject(value) && isPlainObject(next[key])) result[key] = withResets(value, next[key]);
  }
  return result;
}
