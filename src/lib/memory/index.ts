import { generateEmbedding } from './embedding';
import { addRecord, getAllRecords, type MemoryRecord } from './indexeddb';
import { cosineSimilarity } from './similarity';

export interface MemorySearchResult {
    id: number;
    role: 'user' | 'assistant';
    text: string;
    timestamp: number;
    similarity: number;
    recency?: number; 
    relevance?: number; 
}

// generates the embedding to be used for the memory
export async function addMemory(text: string, role: 'user' | 'assistant'): Promise<number> {
    try {
        //console.log(`Generating embedding for memory (${role}): "${text.substring(0, 50)}..."`);
        const embedding = await generateEmbedding(text);
        //console.log(`Embedding generated, size: ${embedding.length}`);

        const record: Omit<MemoryRecord, 'id'> = {
            role,
            text,
            embedding,
            timestamp: Date.now(),
        };

        //console.log("Adding record to IndexedDB...");
        const id = await addRecord(record);
        //console.log(`Memory added successfully with ID: ${id}`);
        return id;
    } catch (error) {
        console.error("Failed to add memory:", error);
        throw error; 
    }
}

/** thank you my good friend gemini-2.5-pro-exp-03-25, LGTM :)
 * Finds memories similar to the query text, considering recency.
 * @param queryText - The text to search for similar memories.
 * @param topK - The maximum number of similar memories to return.
 * @param similarityWeight - Weight for semantic similarity (0.0 to 1.0).
 * @param recencyWeight - Weight for recency (0.0 to 1.0).
 * @returns Promise resolving with an array of the top K most relevant memories, sorted by relevance descending.
 */
export async function findSimilarMemories(
    queryText: string, 
    topK: number = 10, 
    similarityWeight: number = 0.7, // Default weight for similarity
    recencyWeight: number = 0.3   // Default weight for recency
): Promise<MemorySearchResult[]> {
    if (similarityWeight + recencyWeight === 0) {
        console.warn("Similarity and Recency weights cannot both be zero. Using defaults.");
        similarityWeight = 0.7;
        recencyWeight = 0.3;
    }

    try {
        //console.log(`Finding similar memories for query: "${queryText.substring(0, 50)}..." (Weights: Sim=${similarityWeight}, Rec=${recencyWeight})`);
        
        //console.log("Generating query embedding...");
        const queryEmbedding = await generateEmbedding(queryText);
        //console.log(`Query embedding generated, size: ${queryEmbedding.length}`);

        
        //console.log("Retrieving all memory records from IndexedDB...");
        const allRecords = await getAllRecords();
        //console.log(`Retrieved ${allRecords.length} records.`);

        if (allRecords.length === 0) {
            return []; 
        }

        // --- Recency Calculation Setup ---
        const now = Date.now();
        const halfLifeSeconds = 60 * 60 * 24; // Relevance halves roughly every day
        const decayRate = Math.log(2) / halfLifeSeconds;
        // --- End Recency Setup ---

        // 3. Calculate similarity, recency, and relevance for each record
        //console.log("Calculating relevance (similarity + recency)...");
        const scoredResults: MemorySearchResult[] = allRecords.map(record => {
            const similarity = cosineSimilarity(queryEmbedding, record.embedding);
            
            // Calculate recency score (exponential decay)
            const timeDiffSeconds = (now - record.timestamp) / 1000;
            const recency = Math.exp(-decayRate * timeDiffSeconds);

            // Combine scores
            const relevance = (similarityWeight * similarity) + (recencyWeight * recency);

            return {
                id: record.id,
                role: record.role,
                text: record.text,
                timestamp: record.timestamp,
                similarity: similarity,
                recency: recency,
                relevance: relevance,
            };
        });

        // 4. Sort by combined relevance score (descending)
        scoredResults.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));

        // 5. Return the top K results
        const results = scoredResults.slice(0, topK);
        // console.log(`Found ${results.length} most relevant memories (top ${topK}):`, results.map(r => ({ 
        //     id: r.id, 
        //     role: r.role, 
        //     sim: r.similarity.toFixed(4), 
        //     rec: r.recency?.toFixed(4), 
        //     rel: r.relevance?.toFixed(4) 
        // }))); 

        return results;
    } catch (error) {
        console.error("Failed to find similar memories:", error);
        throw error; 
    }
}


export { deleteRecord, clearAllRecords, getRecord, getAllRecords } from './indexeddb';
export { preloadEmbeddingModel } from './embedding';
export { generateEmbedding, cosineSimilarity }; 