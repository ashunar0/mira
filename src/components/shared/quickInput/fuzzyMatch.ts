export type FuzzyMatch = {
  score: number;
  /** 一致した文字の位置（強調表示に使う） */
  positions: number[];
};

const CONSECUTIVE_BONUS = 6;
const WORD_START_BONUS = 8;
const AFTER_SEPARATOR_BONUS = 5;
const CAMEL_CASE_BONUS = 2;
const EXACT_CASE_BONUS = 1;
const GAP_PENALTY = 0.2;
const LEADING_GAP_PENALTY = 0.05;

function positionBonus(target: string, index: number): number {
  if (index === 0) return WORD_START_BONUS;
  const previous = target[index - 1];
  if ("/\\-_. ".includes(previous)) return AFTER_SEPARATOR_BONUS;
  const current = target[index];
  const isUpper = current !== current.toLowerCase();
  const previousIsLower = previous !== previous.toUpperCase();
  return isUpper && previousIsLower ? CAMEL_CASE_BONUS : 0;
}

function isSubsequence(query: string, target: string): boolean {
  let matched = 0;
  for (let i = 0; i < target.length && matched < query.length; i++) {
    if (target[i] === query[matched]) matched++;
  }
  return matched === query.length;
}

/**
 * query の文字が順に target に現れる場合に、最も良い一致の位置を探す。
 * 単語の先頭や連続した一致を高く評価する（VS Code の fuzzyScorer と同じ考え方）。
 * macOS のファイル名は濁点が分解された形のこともあるので、呼び出し側で NFC に揃えておく。
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const m = lowerQuery.length;
  const n = lowerTarget.length;
  if (m === 0) return { score: 0, positions: [] };
  if (!isSubsequence(lowerQuery, lowerTarget)) return null;

  // scores[j * n + i]: query の j 文字目を target の i 文字目に合わせたときの最高点
  const scores = new Float64Array(m * n).fill(Number.NEGATIVE_INFINITY);
  const parents = new Int32Array(m * n).fill(-1);

  for (let j = 0; j < m; j++) {
    let bestBefore = Number.NEGATIVE_INFINITY;
    let bestBeforeIndex = -1;
    for (let i = j; i < n; i++) {
      const adjacent = j > 0 ? scores[(j - 1) * n + i - 1] : Number.NEGATIVE_INFINITY;
      bestBefore -= GAP_PENALTY;
      if (adjacent > bestBefore) {
        bestBefore = adjacent;
        bestBeforeIndex = i - 1;
      }
      if (lowerTarget[i] !== lowerQuery[j]) continue;

      const bonus = positionBonus(target, i) + (target[i] === query[j] ? EXACT_CASE_BONUS : 0);
      if (j === 0) {
        scores[i] = bonus - i * LEADING_GAP_PENALTY;
        continue;
      }
      const viaConsecutive = adjacent + CONSECUTIVE_BONUS;
      const useConsecutive = viaConsecutive >= bestBefore;
      const previous = useConsecutive ? viaConsecutive : bestBefore;
      if (previous === Number.NEGATIVE_INFINITY) continue;
      scores[j * n + i] = previous + bonus + 1;
      parents[j * n + i] = useConsecutive ? i - 1 : bestBeforeIndex;
    }
  }

  let end = -1;
  let score = Number.NEGATIVE_INFINITY;
  for (let i = m - 1; i < n; i++) {
    const candidate = scores[(m - 1) * n + i];
    if (candidate > score) {
      score = candidate;
      end = i;
    }
  }
  if (end === -1) return null;

  const positions = new Array<number>(m);
  for (let j = m - 1, i = end; j >= 0; j--) {
    positions[j] = i;
    i = parents[j * n + i];
  }
  return { score, positions };
}
