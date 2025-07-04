// OpenAI-based worker that maintains the same interface as the original llama-worker.js
// Uses environment variables for OpenAI configuration

let openai = null;
let isInitialized = false;

// Initialize OpenAI client
async function initializeOpenAI() {
  if (isInitialized) return;
  
  try {
    // Import OpenAI dynamically to avoid issues in worker context
    const { OpenAI } = await import('openai');
    
    // In worker context, we need to access environment variables differently
    // The main thread should pass the API key to the worker
    const apiKey = self.openaiApiKey || process.env.OPENAI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key not found. Please set OPENAI_API_KEY or VITE_OPENAI_API_KEY environment variable.");
    }
    
    openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true // Required for browser usage
    });
    
    isInitialized = true;
  } catch (error) {
    console.error("Failed to initialize OpenAI:", error);
    throw error;
  }
}

let requestQueue = [];
let isProcessing = false;

async function processNextRequest() {
  if (isProcessing || requestQueue.length === 0) {
    return;
  }
  
  isProcessing = true;
  
  try {
    const nextRequest = requestQueue.shift();

    if (nextRequest.type === 'generate' || nextRequest.type === 'generate_with_audio') {
      await generate(nextRequest.data);
    } else if (nextRequest.type === 'summarize') {
      await summarize(nextRequest.data); 
    }

  } catch (error) {
    console.error("Error processing request:", error);
    self.postMessage({
      status: "error",
      data: error.toString()
    });
  } finally {
    isProcessing = false;
    // Process next request if any
    if (requestQueue.length > 0) {
      setTimeout(processNextRequest, 0);
    }
  }
}

function addRequestToQueue(type, data) { 
  requestQueue.push({ type, data }); 
  processNextRequest();
}

async function generate(data) {
  const { messages, audio } = data;
  
  try {
    await initializeOpenAI();
    
    // Filter out system messages and prepare for OpenAI
    const openaiMessages = messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }));
    
    // If there's a system message, add it as the first message
    const systemMessage = messages.find(msg => msg.role === 'system');
    if (systemMessage) {
      openaiMessages.unshift({
        role: 'system',
        content: systemMessage.content
      });
    }
    
    // Handle audio input - for OpenAI, we need to process the audio separately
    // and replace the <|audio|> token with the transcribed text
    if (audio) {
      console.warn("Audio input detected but OpenAI chat completion doesn't support audio directly");
      // For now, we'll skip audio processing and just use the text messages
      // The audio should have been transcribed to text before reaching this point
    }
    
    self.postMessage({ status: "start" });
    
    // Create streaming response
    const stream = await openai.chat.completions.create({
      model: "ft:gpt-4o-2024-08-06:slingshot-ai:slg-1-12-9:BouEx6tU", // You can change this to other models
      messages: openaiMessages,
      stream: true,
      max_tokens: 1024,
      temperature: 0.7
    });
    
    let accumulatedText = "";
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        accumulatedText += content;
        
        // Send each token as an update
        self.postMessage({
          status: "update",
          output: content
        });
      }
    }
    
    // Send completion message
    self.postMessage({
      status: "complete",
      output: accumulatedText,
      raw: accumulatedText
    });
    
  } catch (error) {
    console.error("Generation error:", error);
    self.postMessage({
      status: "error",
      data: error.toString()
    });
  }
}

async function summarize(data) {
  const { textToSummarize } = data;
  
  try {
    await initializeOpenAI();
    
    const prompt = `Rewrite the following User Statement from the user's perspective into a single sentence starting with "The user". Focus ONLY on the information stated by the user. Do not add external knowledge, notes, commentary, or formatting.

User Statement:
${textToSummarize}

Rewritten Sentence:`;
    
    self.postMessage({ status: "summarization_start" });
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 72,
      temperature: 0.3
    });
    
    const summary = completion.choices[0]?.message?.content?.trim() || "";
    
    if (!summary) {
      throw new Error("Failed to extract summary content.");
    }
    
    self.postMessage({
      status: "summary_complete",
      summary: summary
    });
    
  } catch (error) {
    console.error("Summarization error:", error);
    self.postMessage({
      status: "summary_error",
      data: error.toString()
    });
  }
}

async function check() {
  try {
    await initializeOpenAI();
    self.postMessage({
      status: "ready"
    });
  } catch (error) {
    self.postMessage({
      status: "error",
      data: error.toString()
    });
  }
}

async function load() {
  self.postMessage({
    status: "loading",
    data: "Initializing OpenAI client..."
  });

  try {
    await initializeOpenAI();
    
    self.postMessage({
      status: "loading",
      data: "Testing connection..."
    });
    
    // Test the connection with a simple request
    await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 1
    });
    
    self.postMessage({ status: "ready" });
  } catch (error) {
    self.postMessage({ 
      status: "error", 
      data: error.toString() 
    });
  }
}

// Listen for messages from the main thread
self.addEventListener("message", async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case "setApiKey":
      // Store the API key for later use
      self.openaiApiKey = data.apiKey;
      break;

    case "check":
      check();
      break;

    case "load":
      load();
      break;

    case "generate": 
    case "generate_with_audio":
      addRequestToQueue(type, data);
      break;

    case "summarize":
      addRequestToQueue(type, data); 
      break;

    case "interrupt":
      // For OpenAI, we can't easily interrupt streaming, but we can clear the queue
      requestQueue = [];
      break;

    case "reset":
      requestQueue = [];
      isProcessing = false;
      break;
  }
}); 