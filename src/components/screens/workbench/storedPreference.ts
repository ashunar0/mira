import { useEffect, useState } from "react";

/** 消えても困らない表示の好みだけを置く。読み書きできない環境では既定値で動く */
export function useStoredPreference<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : (JSON.parse(stored) as T);
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 保存できなくても動作には影響しない
    }
  }, [key, value]);

  return [value, setValue] as const;
}
