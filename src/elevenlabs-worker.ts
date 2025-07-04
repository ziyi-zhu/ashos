import { ElevenLabsClient } from "elevenlabs";

// Load the ElevenLabs client
let elevenlabs: any;
let availableVoices: any[] = [];

try {
  const apiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ElevenLabs API key not found. Please set VITE_ELEVENLABS_API_KEY in your .env file.");
  }
  elevenlabs = new ElevenLabsClient({ apiKey });
  // Get available voices
  const voicesResp = await elevenlabs.voices.getAll();
  availableVoices = voicesResp.voices || [];
  self.postMessage({ status: "ready", voices: availableVoices, device: "api" });
} catch (e: any) {
  self.postMessage({ status: "error", data: e?.message || String(e) });
  throw e;
}

// Flag to track if we're currently processing
let isProcessing = false;
let isInterrupted = false; // Flag for interrupt signal

// Listen for messages from the main thread
self.addEventListener("message", async (e: MessageEvent) => {
  // Handle command messages first
  if (e.data.type) {
    switch (e.data.type) {
      case 'load':
        // Already handled during initialization
        return;
      case 'interrupt':
        isInterrupted = true; // Set the interrupt flag
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
    // First, try to get voice by ID from environment variable
    const voiceIdFromEnv = import.meta.env.VITE_ELEVENLABS_VOICE_ID;
    let selectedVoice;
    
    if (voiceIdFromEnv) {
      // Try to find voice by ID from environment variable
      selectedVoice = availableVoices.find(v => v.voice_id === voiceIdFromEnv);
      if (selectedVoice) {
        console.log(`Using voice from environment variable: ${selectedVoice.name} (${selectedVoice.voice_id})`);
      }
    }
    
    // If no voice found by ID from env, fall back to existing logic
    if (!selectedVoice) {
      // Find the voice by name or use default
      selectedVoice = availableVoices.find(v => v.name === voice) || availableVoices[0];
    }
    
    if (!selectedVoice) {
      throw new Error("No voices available");
    }

    // ElevenLabs API does not support speed directly, so ignore or map if needed
    const response = await elevenlabs.textToSpeech.convert(selectedVoice.voice_id, {
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5,
        style: 0.0,
        use_speaker_boost: true
      }
    });

    // Handle different response formats
    let audioBuffer;
    if (response instanceof ArrayBuffer) {
      audioBuffer = response;
    } else if (response && typeof response === 'object' && response.arrayBuffer) {
      audioBuffer = await response.arrayBuffer();
    } else if (response && typeof response === 'object' && response.buffer) {
      audioBuffer = response.buffer;
    } else if (response instanceof ReadableStream) {
      // Handle ReadableStream from ElevenLabs API
      const reader = response.getReader();
      const chunks: Uint8Array[] = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      
      // Combine all chunks into a single ArrayBuffer
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combinedArray = new Uint8Array(totalLength);
      let offset = 0;
      
      for (const chunk of chunks) {
        combinedArray.set(chunk, offset);
        offset += chunk.length;
      }
      
      audioBuffer = combinedArray.buffer;
    } else {
      console.error("Unexpected response format:", response);
      throw new Error("Unexpected response format from ElevenLabs API");
    }

    // Check if interrupted
    if (isInterrupted) {
      return;
    }

    // Ensure we have valid audio data
    if (!audioBuffer || audioBuffer.byteLength === 0) {
      throw new Error("No audio data received from ElevenLabs");
    }

    // Convert ArrayBuffer to Blob with proper MIME type
    // ElevenLabs returns MP3 data by default
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });

    // Send the audio chunk
    self.postMessage({
      status: "stream",
      chunk: {
        audio: audioBlob,
        text: text,
      },
    });

    // Signal completion
    if (!isInterrupted) { 
      self.postMessage({ status: "complete" }); 
    }

  } catch (error: any) {
    console.error("ElevenLabs TTS error:", error);
    self.postMessage({ 
      status: "error", 
      error: error?.message || "Failed to process text-to-speech request" 
    });
  } finally {
    isProcessing = false;
    isInterrupted = false; // Reset interrupt flag in finally block too
  }
}); 