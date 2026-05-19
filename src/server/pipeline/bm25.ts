/**
 * Generic BM25 over a small candidate set (~hundreds of docs).
 *
 * Extracted from the ver1 validator's BM25 (length-normalized so junk-tag
 * clips don't win by tag count alone) so the ver2 retrieval pipeline can
 * rank candidates without dragging in the rest of the validator. Same
 * defaults — Elastic-standard k1=1.2, b=0.75.
 */

const BM25_K1 = 1.2;
const BM25_B = 0.75;

export interface Bm25Doc {
  id: string;
  /** Already tokenized & lowercased. */
  words: string[];
}

export interface Bm25Index {
  docs: Map<string, string[]>;
  avgDl: number;
  idf: Map<string, number>;
}

export function buildBm25Index(docs: Bm25Doc[]): Bm25Index {
  const docMap = new Map<string, string[]>();
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const d of docs) {
    docMap.set(d.id, d.words);
    totalLen += d.words.length;
    for (const w of new Set(d.words)) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const n = docs.length || 1;
  const idf = new Map<string, number>();
  for (const [w, f] of df) idf.set(w, Math.log(1 + (n - f + 0.5) / (f + 0.5)));
  return { docs: docMap, avgDl: totalLen / n, idf };
}

export function bm25Score(
  queryTerms: string[],
  docId: string,
  index: Bm25Index,
): number {
  const words = index.docs.get(docId);
  if (!words || !words.length) return 0;
  const dl = words.length;
  const avg = index.avgDl || 1;
  const querySet = new Set<string>();
  for (const t of queryTerms) {
    const s = String(t ?? "").toLowerCase().trim();
    if (s) querySet.add(s);
  }
  if (!querySet.size) return 0;
  const docTf = new Map<string, number>();
  for (const w of words) docTf.set(w, (docTf.get(w) ?? 0) + 1);
  let score = 0;
  for (const term of querySet) {
    const tf = docTf.get(term);
    if (!tf) continue;
    const idf = index.idf.get(term) ?? 0;
    const norm = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avg));
    score += (idf * ((BM25_K1 + 1) * tf)) / norm;
  }
  return score;
}

/** Hebrew/English tokenizer — splits on whitespace and punctuation, lowercases. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}\-"׳״'`/\\|]+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}
