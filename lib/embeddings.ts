// ============================================================
// Embeddings — HuggingFace Inference API
// Model: BAAI/bge-small-en-v1.5  →  384 dimensions (free)
//
// BGE best practices (official BAAI docs):
//   DOCUMENTS (stored in DB): embed as-is, NO prefix.
//     → handled in crawler/ingest.py via fastembed
//
//   QUERIES (search/RAG at runtime): MUST add instruction prefix.
//     → "Represent this sentence for searching relevant passages: <query>"
//     → This is the critical difference that improves retrieval recall
//        significantly for short queries against long passages.
//
//   NORMALISATION: embeddings must be L2-normalised before cosine comparison.
//     The HF inference API does NOT guarantee normalisation, so we do it here.
//
//   SIMILARITY RANGE for bge-small-en-v1.5:
//     The model was trained with contrastive loss (temp=0.01), so cosine
//     similarities cluster in [0.6, 1.0] for relevant pairs.
//     A score of 0.5 is already a meaningful match — threshold at 0.5 in SQL.
//     Threshold of 0.1 (old value) returns garbage results.
// ============================================================

const HF_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5";
const HF_API_URL = `https://router.huggingface.co/hf-inference/models/${HF_EMBEDDING_MODEL}/pipeline/feature-extraction`;

// BGE retrieval instruction — prepended to queries ONLY, never to documents
const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

// ---------------------------------------------------------------------------
// L2 normalisation — ensures unit vectors for correct cosine similarity
// ---------------------------------------------------------------------------
function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

// ---------------------------------------------------------------------------
// HuggingFace Inference API call
// ---------------------------------------------------------------------------
async function hfEmbed(texts: string[]): Promise<number[][]> {
  const hfToken = process.env.HUGGINGFACE_API_KEY;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

  // 30s timeout — HF model can be cold-starting (up to 20s warmup)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response: Response;
  try {
    response = await fetch(HF_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs: texts,
        options: { wait_for_model: true, normalize: true },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `HuggingFace embedding error (${response.status}): ${err}`
    );
  }

  const json = await response.json();

  // Parse response shape — HF returns number[][] for array inputs
  let embeddings: number[][];
  if (Array.isArray(json) && Array.isArray(json[0]) && typeof json[0][0] === "number") {
    embeddings = json as number[][];
  } else if (Array.isArray(json) && typeof json[0] === "number") {
    // Single string returned as flat number[]
    embeddings = [json as number[]];
  } else if (Array.isArray(json) && Array.isArray(json[0]) && Array.isArray(json[0][0])) {
    // Extra nesting from some HF endpoints: [[[...]]]
    embeddings = (json as number[][][]).map((v) => v[0]);
  } else {
    throw new Error(
      `Unexpected HuggingFace response shape: ${JSON.stringify(json).slice(0, 200)}`
    );
  }

  // Always L2-normalise — HF API normalize:true hint is not always respected
  return embeddings.map(l2Normalize);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Embed a QUERY string for semantic search / RAG retrieval.
 *
 * Adds the BGE instruction prefix automatically.
 * Result is L2-normalised for cosine similarity via pgvector <=> operator.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // BGE: queries need the instruction prefix, cap at 512 tokens (~2000 chars)
  const prefixed = `${BGE_QUERY_PREFIX}${text}`.slice(0, 2000);
  const results = await hfEmbed([prefixed]);
  return results[0];
}

/**
 * Embed multiple QUERY strings in one API call (for batch operations).
 * Each string gets the BGE instruction prefix.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const prefixed = texts.map((t) => `${BGE_QUERY_PREFIX}${t}`.slice(0, 2000));
  return hfEmbed(prefixed);
}

/**
 * Embed a DOCUMENT/PASSAGE (no prefix, used for indexing content).
 * Documents should never get the query instruction prefix.
 * In practice, document embedding is done in the crawler (fastembed),
 * but this is available for any server-side document ingestion needs.
 */
export async function generateDocumentEmbedding(text: string): Promise<number[]> {
  const results = await hfEmbed([text.slice(0, 2000)]);
  return results[0];
}
