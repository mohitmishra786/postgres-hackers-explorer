import Groq from "groq-sdk";
import { v4 as uuidv4 } from "uuid";
import { generateEmbedding } from "./embeddings";
import {
  getDb,
  Email,
  EmailWithSimilarity,
  SearchFilters,
  SourceEmail,
} from "./db";

// ============================================================
// Types
// ============================================================

export interface RAGResult {
  answer: string;
  sources: SourceEmail[];
  thread_ids: string[];
  query_id: string;
}

interface RetrievedEmail extends EmailWithSimilarity {
  hybrid_score: number;
}

// ============================================================
// Groq client — lazy singleton
// Primary LLM: llama-3.3-70b-versatile (complex) / llama-3.1-8b-instant (simple)
// ============================================================

let _groq: Groq | null = null;

function getGroq(): Groq {
  if (!_groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("Missing GROQ_API_KEY environment variable");
    _groq = new Groq({ apiKey });
  }
  return _groq;
}

// ============================================================
// Step 1: Vector similarity search — raw SQL with pgvector
// ============================================================

async function vectorSearch(
  queryEmbedding: number[],
  filters: SearchFilters,
  limit = 15
): Promise<EmailWithSimilarity[]> {
  const sql = getDb();

  // Format the embedding as a Postgres vector literal: '[0.1,0.2,...]'
  const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

  try {
    const rows = await sql`
      SELECT
        id, message_id, subject, author_name, author_email, date,
        body_new_content, source_url, thread_root_id, thread_depth,
        has_patch, patch_version,
        1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
      FROM emails
      WHERE
        1 - (embedding <=> ${embeddingLiteral}::vector) > 0.15
        AND embedding IS NOT NULL
        AND (${filters.date_from ?? null}::timestamptz IS NULL OR date >= ${filters.date_from ?? null}::timestamptz)
        AND (${filters.date_to ?? null}::timestamptz IS NULL OR date <= ${filters.date_to ?? null}::timestamptz)
        AND (${filters.author ?? null} IS NULL OR author_name ILIKE ${"%" + (filters.author ?? "") + "%"})
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT ${limit}
    `;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (rows as any[]).map((row) => ({
      ...row,
      in_reply_to: null,
      references_ids: [],
      body_clean: null,
      month_period: null,
      git_commit_refs: null,
      created_at: new Date().toISOString(),
      similarity: Number(row.similarity),
    })) as EmailWithSimilarity[];
  } catch (err) {
    console.error("[RAG] Vector search error:", err);
    return [];
  }
}

// ============================================================
// Step 2: Full-text keyword search — raw SQL tsvector
// ============================================================

async function keywordSearch(
  query: string,
  filters: SearchFilters,
  limit = 15
): Promise<EmailWithSimilarity[]> {
  const sql = getDb();

  try {
    const rows = await sql`
      SELECT
        id, message_id, subject, author_name, author_email, date,
        body_new_content, source_url, thread_root_id, thread_depth,
        has_patch, patch_version,
        ts_rank(
          to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(body_new_content,'')),
          websearch_to_tsquery('english', ${query})
        ) AS rank
      FROM emails
      WHERE
        to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(body_new_content,''))
          @@ websearch_to_tsquery('english', ${query})
        AND (${filters.date_from ?? null}::timestamptz IS NULL OR date >= ${filters.date_from ?? null}::timestamptz)
        AND (${filters.date_to ?? null}::timestamptz IS NULL OR date <= ${filters.date_to ?? null}::timestamptz)
        AND (${filters.author ?? null} IS NULL OR author_name ILIKE ${"%" + (filters.author ?? "") + "%"})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (rows as any[]).map((row) => ({
      ...row,
      in_reply_to: null,
      references_ids: [],
      body_clean: null,
      month_period: null,
      git_commit_refs: null,
      created_at: new Date().toISOString(),
      rank: Number(row.rank),
    })) as EmailWithSimilarity[];
  } catch (err) {
    console.error("[RAG] Keyword search error:", err);
    return [];
  }
}

// ============================================================
// Step 3: Hybrid merge and re-rank (0.6 vector + 0.4 keyword)
// ============================================================

function mergeAndRerank(
  vectorResults: EmailWithSimilarity[],
  keywordResults: EmailWithSimilarity[],
  topK = 10
): RetrievedEmail[] {
  const scores = new Map<string, RetrievedEmail>();
  const vectorWeight = 0.6;
  const keywordWeight = 0.4;

  const maxRank = Math.max(...keywordResults.map((r) => r.rank ?? 0), 1);

  for (const email of vectorResults) {
    scores.set(email.message_id, {
      ...email,
      hybrid_score: (email.similarity ?? 0) * vectorWeight,
    });
  }

  for (const email of keywordResults) {
    const normalizedRank = ((email.rank ?? 0) / maxRank) * keywordWeight;
    const existing = scores.get(email.message_id);
    if (existing) {
      existing.hybrid_score += normalizedRank;
    } else {
      scores.set(email.message_id, { ...email, hybrid_score: normalizedRank });
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.hybrid_score - a.hybrid_score)
    .slice(0, topK);
}

// ============================================================
// Step 4: Thread expansion — fetch sibling emails for context
// ============================================================

async function expandThreads(
  emails: RetrievedEmail[],
  queryEmbedding: number[]
): Promise<Email[]> {
  const sql = getDb();
  const allEmails = new Map<string, Email>();
  const MAX_PER_THREAD = 30;
  const MAX_RELEVANT_WITHIN_THREAD = 10;
  const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

  for (const email of emails) {
    allEmails.set(email.message_id, email);
    const rootId = email.thread_root_id;
    if (!rootId) continue;

    try {
      const threadEmails = await sql`
        SELECT * FROM emails
        WHERE thread_root_id = ${rootId}
        ORDER BY date ASC
        LIMIT ${MAX_PER_THREAD + 5}
      ` as unknown as Email[];

      if (threadEmails.length <= MAX_PER_THREAD) {
        for (const te of threadEmails) allEmails.set(te.message_id, te);
      } else {
        // Large thread: pick most relevant via inner vector search
        const relevant = await sql`
          SELECT message_id,
            1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
          FROM emails
          WHERE thread_root_id = ${rootId}
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> ${embeddingLiteral}::vector) > 0.1
          ORDER BY embedding <=> ${embeddingLiteral}::vector
          LIMIT ${MAX_RELEVANT_WITHIN_THREAD}
        ` as unknown as { message_id: string; similarity: number }[];

        const relevantIds = new Set(relevant.map((r) => r.message_id));

        // Always include root
        const root = threadEmails.find((te) => te.message_id === rootId);
        if (root) allEmails.set(root.message_id, root);

        // Include relevant + parent of matched email
        for (const te of threadEmails) {
          if (
            relevantIds.has(te.message_id) ||
            te.message_id === email.in_reply_to
          ) {
            allEmails.set(te.message_id, te);
          }
        }
      }
    } catch (err) {
      console.error("[RAG] Thread expansion error:", err);
    }
  }

  return Array.from(allEmails.values());
}

// ============================================================
// Step 5: Context assembly
// ============================================================

function formatEmailForContext(email: Email, index: number): string {
  const body = email.body_new_content || email.body_clean || "(no body)";
  const truncatedBody = body.slice(0, 2500);
  return `--- Email ${index + 1} ---
From: ${email.author_name ?? "Unknown"} <${email.author_email ?? ""}>
Date: ${email.date}
Subject: ${email.subject}
${email.has_patch ? `[PATCH${email.patch_version ? ` ${email.patch_version}` : ""}]` : ""}
${email.source_url ? `URL: ${email.source_url}` : ""}

${truncatedBody}${body.length > 2500 ? "\n[... truncated ...]" : ""}
`;
}

function assembleContext(
  _matchedEmails: RetrievedEmail[],
  allContextEmails: Email[]
): { context: string; contextEmails: Email[] } {
  const sorted = [...allContextEmails].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const limited = sorted.slice(0, 20);
  const context = limited.map(formatEmailForContext).join("\n\n");
  return { context, contextEmails: limited };
}

// ============================================================
// Step 6: LLM — Groq (primary)
// llama-3.3-70b-versatile for complex queries (3+ threads)
// llama-3.1-8b-instant for simple queries
// ============================================================

const SYSTEM_PROMPT = `You are an expert assistant helping developers explore the PostgreSQL pgsql-hackers mailing list archive.

Answer the user's question based ONLY on the email discussions provided below.
Always cite specific emails by referencing the author name and date.
If the discussions do not contain enough information to answer, say so clearly.
Never make up information about PostgreSQL features, patches, or decisions.
Format your answer in clear paragraphs with good markdown formatting.
Use specific quotes when they strengthen the answer (use > markdown blockquote syntax).
At the end of your answer, list the 3 most relevant source emails in a "## Sources" section using this exact format:
- [Author Name, Date]: Brief description of their contribution`;

async function callGroq(
  question: string,
  context: string,
  isComplex: boolean
): Promise<string> {
  const groq = getGroq();
  const model = isComplex ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant";

  const userMessage = `Question: ${question}

Relevant email discussions from the pgsql-hackers mailing list:

${context}`;

  const response = await groq.chat.completions.create({
    model,
    max_tokens: 1500,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  return response.choices[0]?.message?.content ?? "No answer generated.";
}

// ============================================================
// Step 7: Source extraction
// ============================================================

function getExcerpt(email: Email, maxLength = 200): string {
  const body = email.body_new_content || email.body_clean || "";
  const cleaned = body.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length <= maxLength
    ? cleaned
    : cleaned.slice(0, maxLength - 3) + "...";
}

function extractSources(
  answer: string,
  contextEmails: Email[],
  matchedEmails: RetrievedEmail[]
): SourceEmail[] {
  const matchedScores = new Map(
    matchedEmails.map((e) => [e.message_id, e.hybrid_score])
  );

  const mentionedAuthors = new Set<string>();
  for (const email of contextEmails) {
    if (
      email.author_name &&
      answer.toLowerCase().includes(email.author_name.toLowerCase())
    ) {
      mentionedAuthors.add(email.author_name);
    }
  }

  return contextEmails
    .map((email) => {
      let score = matchedScores.get(email.message_id) ?? 0;
      if (email.author_name && mentionedAuthors.has(email.author_name)) {
        score += 0.2;
      }
      return { email, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ email, score }) => ({
      message_id: email.message_id,
      subject: email.subject,
      author_name: email.author_name,
      date: email.date,
      excerpt: getExcerpt(email, 200),
      source_url: email.source_url,
      thread_root_id: email.thread_root_id,
      relevance_score: Math.min(score, 1),
    }));
}

// ============================================================
// Main RAG entry point
// ============================================================

export async function askQuestion(
  question: string,
  filters: SearchFilters = {}
): Promise<RAGResult> {
  const queryId = uuidv4();

  // Step 1: Embed
  const queryEmbedding = await generateEmbedding(question);

  // Step 2: Hybrid retrieval — parallel
  const [vectorResults, kwResults] = await Promise.all([
    vectorSearch(queryEmbedding, filters),
    keywordSearch(question, filters),
  ]);

  // Step 3: Merge + re-rank
  const merged = mergeAndRerank(vectorResults, kwResults);

  if (merged.length === 0) {
    return {
      answer:
        "No relevant discussions found for your question. The archive may not contain information on this specific topic.",
      sources: [],
      thread_ids: [],
      query_id: queryId,
    };
  }

  // Step 4: Thread expansion
  const expandedEmails = await expandThreads(merged, queryEmbedding);

  // Step 5: Context assembly
  const { context, contextEmails } = assembleContext(merged, expandedEmails);

  // Detect complexity: 3+ distinct threads = complex
  const uniqueThreads = new Set(merged.map((e) => e.thread_root_id));
  const isComplex = uniqueThreads.size >= 3;

  // Step 6: Groq
  const answer = await callGroq(question, context, isComplex);

  // Step 7: Sources
  const sources = extractSources(answer, contextEmails, merged);
  const threadIds = Array.from(uniqueThreads).filter(Boolean) as string[];

  return { answer, sources, thread_ids: threadIds, query_id: queryId };
}
