import {
    TextStreamer,
    InterruptableStoppingCriteria,
    UltravoxProcessor,
    UltravoxModel,
  } from "@huggingface/transformers";
  // a good bulk of this is from https://github.com/huggingface/transformers.js-examples/blob/main/llama-3.2-webgpu/src/worker.js
  /**
   * This class uses the Singleton pattern to enable lazy-loading of the pipeline
   */
  class TextGenerationPipeline {
    static model_id = "onnx-community/ultravox-v0_5-llama-3_2-1b-ONNX";
    static processor = null;
    static model = null;
  
    static async getInstance(progress_callback = null) {
      this.processor ??= UltravoxProcessor.from_pretrained(this.model_id, {
        progress_callback,
      });
  
      this.model ??= UltravoxModel.from_pretrained(this.model_id, {
        dtype: {
          embed_tokens: "fp32",
          audio_encoder: "q4",
          decoder_model_merged: "q4",
        },
        device: "webgpu",
        progress_callback,
      });
  
      return Promise.all([this.processor, this.model]);
    }
  }
  
  const stopping_criteria = new InterruptableStoppingCriteria();
  

  function extractAssistantResponse(text) {

    const assistantMarker = text.lastIndexOf("assistant");
    if (assistantMarker !== -1) {
      const assistantText = text.substring(assistantMarker + "assistant".length).trim();
      if (assistantText) return assistantText;
    }
  
    const responsePattern = /(?:helloassistant|hello assistant)([\s\S]*?)$/i;
    const match = text.match(responsePattern);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
    

    return text.replace(/system[\s\S]*?user/i, "")
              .replace(/Cutting Knowledge Date:[\s\S]*?Today Date:[\s\S]*?\d{4}/i, "")
              .replace(/\b(user|assistant|system)\b/gi, "")
              .trim();
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
        setTimeout(processNextRequest, 0); // Set delay to 0
      }
    }
  }


  function addRequestToQueue(type, data) { 
    requestQueue.push({ type, data }); 
    processNextRequest();
  }
  
  let past_key_values_cache = null;
  async function generate(data) {
    const { messages, audio } = data;
    // Log 
    // console.log(
    //   `UltravoxWorker: Received '${audio ? 'generate_with_audio' : 'generate'}' request.`, 
    //   `Messages count: ${messages.length}. Audio provided? ${!!audio}. Audio length: ${audio?.length ?? 'N/A'}`
    // );
    
    // Reset any cached state to prevent conflicts
    past_key_values_cache = null;
    stopping_criteria.reset();
    
    try {
      const [processor, model] = await TextGenerationPipeline.getInstance();
  

      const textPrompt = processor.tokenizer.apply_chat_template(messages, {
        add_generation_prompt: true,
        tokenize: false, 
      });
      //console.log("Formatted text prompt:", textPrompt);
  

      //console.log(`UltravoxWorker: Calling processor with text prompt and audio (is audio present? ${!!audio})`);
      const inputs = await processor(textPrompt, audio); 
  
      let accumulatedText = "";
      

      const callback_function = (output) => {
        self.postMessage({
          status: "update",
          output: output, 
        });
      };
  

      const streamer = new TextStreamer(processor.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function, 
      });
  

      self.postMessage({ status: "start" });
  

      const { sequences } = await model.generate({
        ...inputs,
        // past_key_values: null, 
        do_sample: false,
        max_new_tokens: 1024, 
        streamer,
        stopping_criteria,
        return_dict_in_generate: true, 
      });
  

      const inputTokenLength = inputs.input_ids.dims.at(-1);
      const generated_ids_sliced = sequences.slice(null, [inputTokenLength, null]);
      const decoded = processor.batch_decode(generated_ids_sliced, {
        skip_special_tokens: true,
      });
      //console.log("Raw decoded output:", decoded[0]);
  
      // Clean the final decoded output *only once* at the end
      const finalOutput = extractAssistantResponse(decoded[0]);
      //console.log("Cleaned final output:", finalOutput);
  
      // Send the final, cleaned output back to the main thread
      self.postMessage({
        status: "complete",
        output: finalOutput,
        raw: decoded[0], // For debugging
      });
      
      //console.log("Generation completed successfully");
    } catch (error) {
      console.error("Generation error:", error);
      self.postMessage({
        status: "error",
        data: error.toString(),
      });
    }
  }
  
  async function summarize(data) {
    const { textToSummarize } = data; 
    //console.log(`UltravoxWorker: Received 'summarize' request for user input.`);
  
    try {
      const [processor, model] = await TextGenerationPipeline.getInstance();
  
      // third person rephrasing as a way to summarize (this actually works waaay better than I expected)
      const prompt = `Rewrite the following User Statement from the user's perspective into a single sentence starting with "The user". Focus ONLY on the information stated by the user. Do not add external knowledge, notes,commentary, or formatting.\n\nUser Statement:\n${textToSummarize}\n\nRewritten Sentence:`;
      //console.log("Summarization prompt prepared (third-person rephrase).");
  
      const inputs = processor.tokenizer(prompt, { return_tensors: "pt" });
     // console.log("Inputs tokenized for summarization.");
  
      self.postMessage({ status: "summarization_start" });
  

      const { sequences } = await model.generate({
        ...inputs,
        max_new_tokens: 72, // 72 is good i think
        do_sample: false,   
        num_beams: 1,
        return_dict_in_generate: true,
      });
      //console.log("Summarization generation complete.");
  
      const inputTokenLength = inputs.input_ids.dims.at(-1);
      if (!sequences || !sequences.slice) {
          console.error("Summarization error: 'sequences' is not in the expected format.", sequences);
          throw new Error("Summarization failed: Invalid output structure from model.generate.");
      }
      const generated_ids_sliced = sequences.slice(null, [inputTokenLength, null]);
  
      const decoded = processor.batch_decode(generated_ids_sliced, {
        skip_special_tokens: true,
      });
      //console.log("Raw decoded summary output:", decoded[0]);
  
      const finalSummary = decoded[0]?.trim() || "";
      //console.log("Final summary:", finalSummary);
  
      if (!finalSummary) {
          console.warn("Summarization resulted in an empty string after decoding.");
          self.postMessage({ status: "summary_error", error: "Failed to extract summary content." });
          return; 
      }
  
      self.postMessage({
        status: "summary_complete",
        summary: finalSummary,
      });
  
      //console.log("Summarization completed successfully");
  
    } catch (error) {
      console.error("Summarization error:", error);
      self.postMessage({
        status: "summary_error", 
        data: error.toString(),
      });
    }
  }

  async function check() {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error("WebGPU is not supported (no adapter found)");
      }
    } catch (e) {
      self.postMessage({
        status: "error",
        data: e.toString(),
      });
    }
  }
  
  async function load() {
    self.postMessage({
      status: "loading",
      data: "Loading model...",
    });
  
    try {
      // Load the pipeline and save it for future use.
      const [processor, model] = await TextGenerationPipeline.getInstance((x) => {
        self.postMessage(x);
      });
  
      self.postMessage({
        status: "loading",
        data: "Compiling shaders and warming up model...",
      });
  
      // Run model with dummy input to compile shaders
      // Need appropriate dummy input for Ultravox
      const dummyText = processor.tokenizer.apply_chat_template([
        { role: "user", content: "warmup <|audio|>" }
      ], { add_generation_prompt: true, tokenize: false });
      const dummyAudio = new Float32Array(160); // Short silent audio
      const dummyInputs = await processor(dummyText, dummyAudio);
      await model.generate({ ...dummyInputs, max_new_tokens: 1 });
  
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
    //console.log("Worker received message:", type);
  
    switch (type) {
      case "check":
        check();
        break;
  
      case "load":
        load();
        break;
  
      case "generate": 
      case "generate_with_audio": // Handle text + audio
        addRequestToQueue(type, data);
        break;
  
      case "summarize":
        addRequestToQueue(type, data); 
        break;

      case "interrupt":
        stopping_criteria.interrupt();
        requestQueue = [];
        break;
  
      case "reset":
        past_key_values_cache = null;
        stopping_criteria.reset();
        requestQueue = [];
        isProcessing = false;
        break;
    }
  }); 