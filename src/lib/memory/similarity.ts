// dot product of two vectors
function dotProduct(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length for dot product.");
  }
  let product = 0;
  for (let i = 0; i < vecA.length; i++) {
    product += vecA[i] * vecB[i];
  }
  return product;
}

// magnitude of a vector
function magnitude(vec: number[]): number {
  let sumOfSquares = 0;
  for (let i = 0; i < vec.length; i++) {
    sumOfSquares += vec[i] * vec[i];
  }
  return Math.sqrt(sumOfSquares);
}

// cosine similarity between two vectors
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length for cosine similarity.");
  }

  const magA = magnitude(vecA);
  const magB = magnitude(vecB);

  // if zero vectors
  if (magA === 0 || magB === 0) {
   
    return 0;
  }

  const dot = dotProduct(vecA, vecB);

  return dot / (magA * magB);
} 