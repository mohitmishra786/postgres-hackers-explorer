// ============================================================
// Embeddings — HuggingFace Inference API (primary + only)
// Model: BAAI/bge-small-en-v1.5  →  384 dimensions (free, no key needed)
//
// The openai package is kept in package.json because groq-sdk wraps it,
// but we do NOT use it for embeddings. Groq has no embedding endpoint.
// ============================================================

const HF_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5";
const HF_API_URL = `https://router.huggingface.co/hf-inference/models/${HF_EMBEDDING_MODEL}/pipeline/feature-extraction`;

async function hfEmbed(texts: string[]): Promise<number[][]> {
  const hfToken = process.env.HUGGINGFACE_API_KEY;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

  // 25s timeout — HF model can be cold-starting (takes up to 20s)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  let response: Response;
  try {
    response = await fetch(HF_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs: texts,
        options: { wait_for_model: true },
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

  // HF returns number[][] when inputs is an array of strings
  if (Array.isArray(json) && Array.isArray(json[0]) && typeof json[0][0] === "number") {
    return json as number[][];
  }

  // Single string input returned as number[]
  if (Array.isArray(json) && typeof json[0] === "number") {
    return [json as number[]];
  }

  // Sometimes HF wraps in an extra nesting level: [[[...]]]
  if (Array.isArray(json) && Array.isArray(json[0]) && Array.isArray(json[0][0])) {
    return (json as number[][][]).map((v) => v[0]);
  }

  throw new Error(`Unexpected HuggingFace response shape: ${JSON.stringify(json).slice(0, 200)}`);
}

/**
 * Generate a single 384-dim embedding for one text string.
 * Uses HuggingFace BAAI/bge-small-en-v1.5 (free, no key required).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const truncated = text.slice(0, 32000);
  const results = await hfEmbed([truncated]);
  return results[0];
}

/**
 * Generate 384-dim embeddings for multiple texts in one API call.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const truncated = texts.map((t) => t.slice(0, 32000));
  return hfEmbed(truncated);
}
