/**
 * embeddings.js — Local Embedding Engine for RAG
 * 
 * WHAT THIS DOES:
 * Converts text (emails) into arrays of numbers called "vectors".
 * Similar texts produce similar vectors, so we can find relevant emails
 * by comparing vector similarity.
 * 
 * WHY LOCAL:
 * Uses @xenova/transformers to run the ML model directly on your machine.
 * No API key needed, no internet needed after first download.
 * 
 * MODEL: all-MiniLM-L6-v2 (~23MB, fast, good quality)
 */

const { Pipeline, pipeline } = require("@xenova/transformers");

// Singleton: load the model ONCE, reuse for every request
let embeddingPipeline = null;

/**
 * Gets or creates the embedding pipeline (singleton pattern).
 * First call downloads the model (~23MB), subsequent calls are instant.
 */
async function getPipeline() {
  if (!embeddingPipeline) {
    console.log("⏳ Loading embedding model (first time only)...");
    embeddingPipeline = await pipeline(
      "feature-extraction",       // Task: convert text → vector
      "Xenova/all-MiniLM-L6-v2"   // Model: small but effective
    );
    console.log("✅ Embedding model loaded!");
  }
  return embeddingPipeline;
}

/**
 * Embed a single text string into a vector (array of numbers).
 * 
 * Example:
 *   "Meeting tomorrow at 3pm" → [0.23, 0.87, 0.12, ..., 0.45] (384 numbers)
 * 
 * @param {string} text - The text to embed
 * @returns {number[]} - A 384-dimensional vector
 */
async function embedText(text) {
  const pipe = await getPipeline();
  const output = await pipe(text, {
    pooling: "mean",      // Average all token vectors into one
    normalize: true        // Normalize so cosine similarity works correctly
  });
  return Array.from(output.data);
}

/**
 * Embed multiple texts at once.
 * 
 * @param {string[]} texts - Array of texts to embed
 * @returns {number[][]} - Array of vectors
 */
async function embedTexts(texts) {
  const promises = texts.map(text => embedText(text));
  return await Promise.all(promises);
}

/**
 * Calculate cosine similarity between two vectors.
 * Returns a number between -1 and 1.
 *   1  = identical meaning
 *   0  = unrelated
 *  -1  = opposite meaning
 * 
 * This is how we find "similar" emails to a search query.
 */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Search for the most similar texts to a query.
 * 
 * HOW IT WORKS:
 * 1. Embed the user's question into a vector
 * 2. Compare it against all email vectors using cosine similarity
 * 3. Return the top-k most similar emails
 * 
 * @param {string} query - User's question
 * @param {Array<{text: string, vector: number[], metadata: object}>} documents - Embedded emails
 * @param {number} topK - Number of results to return (default: 5)
 * @returns {Array<{text: string, metadata: object, score: number}>}
 */
async function similaritySearch(query, documents, topK = 5) {
  const queryVector = await embedText(query);

  const scored = documents.map(doc => ({
    text: doc.text,
    metadata: doc.metadata,
    score: cosineSimilarity(queryVector, doc.vector)
  }));

  // Sort by similarity (highest first) and take top-k
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

module.exports = { embedText, embedTexts, similaritySearch, getPipeline };
