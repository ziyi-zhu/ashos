import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import { detectWebGPU } from "./utils";
// a good bulk of this is from https://github.com/xenova/kokoro-web/blob/main/src/worker.ts
// Device detection
const device = (await detectWebGPU()) ? "webgpu" : "wasm";
self.postMessage({ status: "device", device });

// Load the model
let tts: KokoroTTS;
try {
  const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
  tts = await KokoroTTS.from_pretrained(model_id, {
    dtype: device === "webgpu" ? "fp32" : "q8",
    device,
  });
  self.postMessage({ status: "ready", voices: tts.voices, device });
} catch (e: any) {
  self.postMessage({ status: "error", data: e?.message || String(e) });
  throw e;
}

// Flag to track if we're currently processing
let isProcessing = false;
let isInterrupted = false; // Flag for interrupt signal

// Listen for messages from the main thread
self.addEventListener("message", async (e: MessageEvent) => {
  // Add this log to see the actual device value during processing
  //console.log(`TTS Worker: Received message type ${e.data?.type || '(data object)'}. Current device: ${device}`);

  // Handle command messages first
  if (e.data.type) {
    switch (e.data.type) {
      case 'load':
        // Already handled during initialization
        return;
      case 'interrupt':
        //console.log("TTS Worker received interrupt signal.");
        isInterrupted = true; // Set the interrupt flag
        // If currently processing, the loop check should catch this.
        // We don't forcefully kill the session here, rely on the flag.
        return;
      default:
        console.warn("Unknown TTS worker command type:", e.data.type);
        return;
    }
  }

  // If already processing, send an error and do not proceed
  if (isProcessing) {
    self.postMessage({ 
      status: "error", 
      error: "Already processing another TTS request. Please wait until it completes.",
    });
    return;
  }

  isProcessing = true;
  isInterrupted = false; // Reset interrupt flag for new request
  const { text, voice, speed } = e.data;

  try {
    const streamer = new TextSplitterStream();
    streamer.push(text);
    streamer.close(); // Indicate we won't add more text

    // Log the inputs for debugging
    try {
      // Use stream with error handling
      const stream = tts.stream(streamer, { voice, speed });

      for await (const { text, audio } of stream) {
        // Check interrupt flag within the loop
        if (isInterrupted) {
          //console.log("TTS Worker: Interrupt detected, stopping stream processing.");
          break; // Exit the loop
        }
        self.postMessage({
          status: "stream",
          chunk: {
            audio: audio.toBlob(),
            text,
          },
        });
      }

      // Signal completion without sending merged audio
      // Only send complete if we weren't interrupted
      if (!isInterrupted) { 
        self.postMessage({ status: "complete" }); 
      }
    } catch (streamError: any) {
      console.error("Error during TTS streaming:", streamError);
      // If we get a "Session already started" error, we may need to reinitialize
      if (streamError?.message?.includes("Session already started")) {
        self.postMessage({ 
          status: "error", 
          error: "TTS session error. Try again in a moment." 
        });
        
        // Attempt to reinitialize the model if needed
        try {
          const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
          tts = await KokoroTTS.from_pretrained(model_id, {
            dtype: device === "wasm" ? "q8" : "fp32",
            device,
          });
          // Don't notify UI as this is a silent recovery attempt
        } catch (reinitError: any) {
          console.error("Failed to reinitialize TTS model:", reinitError);
        }
      } else {
        self.postMessage({ 
          status: "error", 
          error: streamError?.message || "Error generating speech" 
        });
      }
    }
  } catch (error: any) {
    console.error("General TTS error:", error);
    self.postMessage({ 
      status: "error", 
      error: error?.message || "Failed to process text-to-speech request" 
    });
  } finally {
    isProcessing = false;
    isInterrupted = false; // Reset interrupt flag in finally block too
  }
});
