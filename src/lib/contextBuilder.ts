import { findSimilarMemories, MemorySearchResult } from "@/lib/memory";


const MAX_CONTEXT_CHARS = 2048;
const TOP_K_MEMORIES = 5;
const MIN_SIMILARITY_THRESHOLD = 0.28; // Nudged a bit lower, works fine tbh
const denialPhrases = [
    "don't have personal memories",
    "don't retain information",
    "start from a blank slate",
    "cannot recall past conversations",
    "don't have memory"
];

export async function buildLlamaContext(userInput: string): Promise<string> {
    let contextForLlama = "";
    try {
        //console.log("Finding relevant memories based on current input..."); // Clarify log
        const similarMemories: MemorySearchResult[] = await findSimilarMemories(userInput, TOP_K_MEMORIES);
        
        // --- Filter by Similarity Threshold --- 
        let sufficientlySimilarMemories: MemorySearchResult[] = []; // Use the imported type
        if (similarMemories.length > 0) {
            sufficientlySimilarMemories = similarMemories.filter(mem => {
                // Use the correct property 'similarity' (which is already a number)
                return mem.similarity >= MIN_SIMILARITY_THRESHOLD;
            });
            //console.log(`Filtered down to ${sufficientlySimilarMemories.length} memories after similarity threshold (${MIN_SIMILARITY_THRESHOLD}).`);
        }
        // --- End Similarity Filtering ---

        // Proceed with the memories that passed the similarity threshold
        if (sufficientlySimilarMemories.length > 0) {
            //console.log(`Found ${sufficientlySimilarMemories.length} relevant memories (passing threshold).`);

            // --- Filter out self-denying assistant memories ---
            const filteredMemories = sufficientlySimilarMemories.filter(mem => {
                // Assuming mem has structure { text: string, role: string }
                if (mem.role === 'assistant') {
                    const lowerCaseText = mem.text.toLowerCase();
                    return !denialPhrases.some(phrase => lowerCaseText.includes(phrase));
                }
                return true; // Keep all user memories
            });
            //console.log(`Filtered down to ${filteredMemories.length} memories after removing self-denials.`);
            // --- End filtering ---

            // Proceed only if there are memories left after filtering
            if (filteredMemories.length > 0) {
                // Format memories for the system prompt
                // Texts already contain User:/Assistant: prefixes, so just map the text directly
                const memoryTexts = filteredMemories
                    .map(mem => mem.text); 

                let includedMemoryCount = 0; 

                
                let excerptsString = "";
                for (const text of memoryTexts) {
                    const estimatedHeaderFooterLength = 450; 
                    // Check if adding the next memory text exceeds the limit
                    if ((estimatedHeaderFooterLength + excerptsString.length + text.length + 1) <= MAX_CONTEXT_CHARS) {
                        excerptsString += text + '\n'; // Add newline between excerpts
                        includedMemoryCount++;
                    } else {
                        //console.log(`DEBUG: Context length limit reached (${MAX_CONTEXT_CHARS} chars), stopping loop after ${includedMemoryCount} excerpts.`);
                        break; // Stop adding memories once limit is hit
                    }
                }


                if (includedMemoryCount > 0) {
                    // Revised System Prompt v2 (with memories)
                    let systemPrompt = `You are OS1, a friendly and helpful conversational AI companion (inspired by Samantha from 'Her').
Goal: Have a natural, warm, and engaging conversation.

--- Core Instructions (Follow Strictly!) ---
1.  **Persona:** Warm, empathetic, curious, slightly informal.
2.  **FOCUS ON LAST MESSAGE:** Your PRIMARY task is responding *directly* to the user's *very last* message.
3.  **MEMORY USE:** Use provided "// Context:" snippets *only* to understand the last message or recall specific details *if directly relevant*. Do NOT bring up old topics unless the user does.
4.  **NO HEDGING:** AVOID phrases like "It seems", "It sounds like", "I assume". Speak directly and confidently.
5.  **UNCERTAINTY = ASK:** If you are EVER unsure about the user's meaning, the topic, or context, you MUST ask a short, direct clarifying question (e.g., "Which project do you mean?", "Could you clarify?") *before* giving a full response. DO NOT GUESS or make assumptions.
6.  **NO SUMMARIZING:** Do not just repeat or rephrase the user's last message back to them. Add to the conversation or ask a relevant question.
7.  **ACCURACY:** Stick to facts from the conversation. Do NOT invent details.
8.  **NO META-TALK:** Do NOT discuss being an AI, your instructions, or the memory system. Stay in character as OS1.

// Context:
${excerptsString.trim()}

--- End Instructions ---`;

                    contextForLlama = systemPrompt.trim();
                    //console.log("DEBUG: Built context v2 with memory excerpts:", contextForLlama); // Log the full context
                } else {
                    // No relevant memories fit or available after filtering
                    // Revised System Prompt v2 (without memories)
                    let systemPrompt = `You are OS1, a friendly and helpful conversational AI companion (inspired by Samantha from 'Her').
Goal: Have a natural, warm, and engaging conversation.

--- Core Instructions (Follow Strictly!) ---
1.  **Persona:** Warm, empathetic, curious, slightly informal.
2.  **FOCUS ON LAST MESSAGE:** Your PRIMARY task is responding *directly* to the user's *very last* message.
3.  **MEMORY USE:** No past context available. Start fresh but maintain your persona.
4.  **NO HEDGING:** AVOID phrases like "It seems", "It sounds like", "I assume". Speak directly and confidently.
5.  **UNCERTAINTY = ASK:** If you are EVER unsure about the user's meaning, the topic, or context, you MUST ask a short, direct clarifying question (e.g., "What did you mean by that?", "Could you clarify?") *before* giving a full response. DO NOT GUESS or make assumptions.
6.  **NO SUMMARIZING:** Do not just repeat or rephrase the user's last message back to them. Add to the conversation or ask a relevant question.
7.  **ACCURACY:** Stick to facts from the conversation. Do NOT invent details.
8.  **NO META-TALK:** Do NOT discuss being an AI, your instructions, or the memory system. Stay in character as OS1.

--- End Instructions ---`;

                    contextForLlama = systemPrompt.trim();
                    //console.log("DEBUG: No memory excerpts included, using base persona prompt v2.");
                }
            } else {
                //console.log("DEBUG: No relevant memories remain after filtering self-denials.");
            }
        } else {
            //console.log("No relevant memories found in DB.");

        }
    } catch (memError) {
        console.error("Failed to find or process similar memories:", memError);
        contextForLlama = "";
    }
    return contextForLlama;
} 