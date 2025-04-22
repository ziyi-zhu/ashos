import {
  pipeline,
  type PipelineType,
  type FeatureExtractionPipeline,
  type FeatureExtractionPipelineOptions,
  type ProgressCallback,
  type Tensor,
} from "@huggingface/transformers";


const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const TASK: PipelineType = "feature-extraction";

let instance: FeatureExtractionPipeline | null = null;
let instancePromise: Promise<FeatureExtractionPipeline> | null = null;


async function getInstance(progress_callback?: ProgressCallback): Promise<FeatureExtractionPipeline> {
  if (instance) {
    return instance;
  }

  if (!instancePromise) {
      instancePromise = new Promise(async (resolve, reject) => {
          try {
              console.log("Loading embedding model...");
              const pipelineInstance = await pipeline(TASK, MODEL_ID, {
                  progress_callback,
                  dtype: 'q8'
              });
              instance = pipelineInstance as FeatureExtractionPipeline;
              console.log("Embedding model loaded successfully.");
              resolve(instance);
          } catch (error) {
              console.error("Failed to load embedding model:", error);
              instancePromise = null; 
              reject(error);
          }
      });
  }

  return instancePromise;
}


export async function generateEmbedding(
    text: string,
    options: FeatureExtractionPipelineOptions = { pooling: 'mean', normalize: true }
): Promise<number[]> {
    const extractor = await getInstance();
    if (!extractor) {
        throw new Error("Embedding pipeline not initialized.");
    }

    try {
        const output: Tensor = await extractor(text, options);
        const resultList = output.tolist();
        if (Array.isArray(resultList) && Array.isArray(resultList[0])) {
            return resultList[0];
        } else {
            console.warn("Unexpected embedding output structure:", resultList);
            if (Array.isArray(resultList) && resultList.every(item => typeof item === 'number')) {
                return resultList as number[];
            }
            throw new Error("Unexpected embedding output structure");
        }
    } catch (error) {
        console.error("Error generating embedding:", error);
        throw error;
    }
}

export async function preloadEmbeddingModel(progress_callback?: ProgressCallback) {
    try {
        await getInstance(progress_callback);
    } catch (error) {
        console.error("Failed to preload embedding model:", error);
    }
} 