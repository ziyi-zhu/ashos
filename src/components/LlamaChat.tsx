import { useState, useEffect, useRef, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Send, Mic, MicOff, BrainCircuit } from "lucide-react";
import { addMemory, preloadEmbeddingModel, getAllMemories, deleteMemory, MemoryRecord } from "@/lib/memory";
import { toast } from "sonner";
import { buildLlamaContext } from "@/lib/contextBuilder";
import type { Voices, Message, TTSRequest } from "@/types/chat";
import { OS1Animation } from "./OS1Animation";
import { AudioVisualizer } from "./AudioVisualizer";
import "./OS1Animation.css";
import { useWhisperRecorder } from "@/hooks/useWhisperRecorder";
import { MemoryViewer } from "./MemoryViewer";


const DENIAL_PHRASES_FOR_STORAGE = [
  "don't have personal memories",
  "don't retain information",
  "start from a blank slate",
  "cannot recall past conversations",
  "don't have memory",
  "i cannot recall", 
  "i don't recall",
  "i am unable to recall",
  "i don't have information about you",
  "i don't know your name" 
];

export function LlamaChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const speed = 1;
  const selectedVoice: keyof Voices = "af_heart";
  const [isTTSProcessing, setIsTTSProcessing] = useState(false);
  const [audioChunkQueue, setAudioChunkQueue] = useState<Blob[]>([]);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  
  const ttsQueue = useRef<TTSRequest[]>([]);
  const isProcessingTTS = useRef(false);
  const hasAutoSpoken = useRef(false);
  const ttsStartTimeRef = useRef<number | null>(null);
  
  const llamaWorker = useRef<Worker | null>(null);
  const kokoroWorker = useRef<Worker | null>(null);
  
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [llamaStatus, setLlamaStatus] = useState<"loading" | "ready" | "error">("loading");
  const [kokoroStatus, setKokoroStatus] = useState<"loading" | "ready" | "error">("loading");
  const [componentError, setComponentError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [showLoadingAnimation, setShowLoadingAnimation] = useState(false);
  const [inputReady, setInputReady] = useState(false);
  
  const messageEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const latestResponseRef = useRef<string>("");
  const latestUserSubmitRef = useRef<string>(""); 
  const messagesRef = useRef<Message[]>([]);
  const currentSentenceBufferRef = useRef<string>("");
  const latestAudioDataRef = useRef<Float32Array | null>(null);
  const inputRef = useRef(input);
  const isProcessingRef = useRef(isProcessing);

  // --- State for Memory Viewer ---
  const [isMemoryViewerOpen, setIsMemoryViewerOpen] = useState(false);
  const [memoryList, setMemoryList] = useState<MemoryRecord[]>([]);
  const [isMemoryLoading, setIsMemoryLoading] = useState(false); // Optional: for loading state
  // --- End Memory Viewer State ---

  // --- Ref to track viewer state for callbacks ---
  const isMemoryViewerOpenRef = useRef(isMemoryViewerOpen);
  // --- End ref --- 

  useEffect(() => { inputRef.current = input; }, [input]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

  useEffect(() => {
    document.body.classList.add('os1-theme');
    return () => { document.body.classList.remove('os1-theme'); };
  }, []);

  const buildContextMemo = useCallback(async (userInput: string) => {
    try {
      return await buildLlamaContext(userInput);
    } catch (buildError) {
      //console.error("Error building Llama context:", buildError);
      //toast.error("Failed to process memories for context.");
      return "";
    }
  }, []);

  const updateMessages = useCallback((text: string) => {
    setMessages(prev => {
      const newMessages = [...prev];
      if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === "assistant") {
        newMessages[newMessages.length - 1] = { 
          ...newMessages[newMessages.length - 1], 
          content: text 
        };
      }
      return newMessages;
    });
  }, []);


  const interruptAndCleanup = useCallback(() => {
    //console.log("--- Running Interrupt and Cleanup --- ");
    llamaWorker.current?.postMessage({ type: 'interrupt' });
    kokoroWorker.current?.postMessage({ type: 'interrupt' });

    if (audioRef.current) {
      if (!audioRef.current.paused) {
          audioRef.current.pause();
      }
      audioRef.current.removeAttribute('src'); 
    }
    setIsAudioPlaying(false); 

    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }

    setAudioChunkQueue([]); 

    ttsQueue.current = []; 

    isProcessingTTS.current = false;
    setIsTTSProcessing(false); 

    currentSentenceBufferRef.current = "";

    hasAutoSpoken.current = false; 
      
    setIsProcessing(false);
    isProcessingRef.current = false; 

  }, [setIsProcessing]); 


  const speakText = (text: string) => {
    if (!text || !kokoroWorker.current) return;
    const trimmedText = text.trim();
    if (trimmedText === "") return;

    // --- Add Sanitization ---
    const sanitizedText = trimmedText.replace(/\*/g, ''); // Remove all asterisks
    // --- End Sanitization ---

    // Use the sanitized text for logging and queuing
    //console.log(`Queueing TTS for: \"${sanitizedText.substring(0, 30)}...\"`);
    ttsQueue.current.push({ text: sanitizedText, voice: selectedVoice, speed });
    if (!isProcessingTTS.current) {
      processNextTTSRequest();
    }
  };

  const processNextTTSRequest = () => {
    if (isProcessingTTS.current || ttsQueue.current.length === 0) {
      if (isProcessingTTS.current && ttsQueue.current.length === 0) {
          isProcessingTTS.current = false;
          setIsTTSProcessing(false);
      }
      return;
    }
    isProcessingTTS.current = true;
    setIsTTSProcessing(true);
    const request = ttsQueue.current[0];
    if (kokoroWorker.current) {
      ttsStartTimeRef.current = performance.now();
      //console.log(`TTS Start: Sending request for text: "${request.text.substring(0, 40)}..."`);
      kokoroWorker.current.postMessage(request);
    } else {
      console.error("Kokoro worker not available when trying to process TTS queue");
      ttsQueue.current.shift();
      isProcessingTTS.current = false;
      setIsTTSProcessing(false);
      ttsStartTimeRef.current = null;
      toast.error("Text-to-speech worker not available.");
    }
  };

  const playNextChunk = useCallback(() => {
    if (audioChunkQueue.length === 0) {
      //console.log("PlayNextChunk: Queue empty, skipping.");
      return;
    }
    
    if (isAudioPlaying) {
      //console.log("PlayNextChunk: Audio already playing, waiting for current chunk to finish.");
      return;
    }
    
    const nextChunk = audioChunkQueue[0];
    //console.log("PlayNextChunk: Preparing chunk, size:", nextChunk.size);

    if (currentAudioUrlRef.current) {
      //console.log("Revoking previous URL:", currentAudioUrlRef.current);
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }

    const url = URL.createObjectURL(nextChunk);
    currentAudioUrlRef.current = url;

    if (!audioRef.current) {
      //console.log("Creating new Audio element");
      audioRef.current = new Audio();
      
      audioRef.current.onended = () => {
        //console.log("Audio ended, setting isAudioPlaying to false");
        setIsAudioPlaying(false);
      };
      
      audioRef.current.onerror = (e) => {
        console.error("Audio playback error:", e);
        if (currentAudioUrlRef.current === audioRef.current?.src) {
          //console.log("Revoking URL on error:", currentAudioUrlRef.current);
          URL.revokeObjectURL(currentAudioUrlRef.current);
          currentAudioUrlRef.current = null;
        }
        setIsAudioPlaying(false);
      };
    }

    setAudioChunkQueue(prev => prev.slice(1));

    //console.log("Setting src and playing:", url);
    audioRef.current.src = url;
    
    setIsAudioPlaying(true);
    
    audioRef.current.play().then(() => {
      //console.log("Playback started successfully for URL:", url);
    }).catch(err => {
      console.error(`Error starting audio playback for ${url}:`, err);
      if (currentAudioUrlRef.current === url) {
        //console.log("Revoking URL on play() error:", currentAudioUrlRef.current);
        URL.revokeObjectURL(currentAudioUrlRef.current);
        currentAudioUrlRef.current = null;
      }
      setIsAudioPlaying(false);
    });
  }, [audioChunkQueue.length, isAudioPlaying]);

  const generateWelcomeBackMessage = useCallback(async () => {
      if (isProcessingRef.current || status !== 'ready') {
          //console.log("generateWelcomeBackMessage: Skipping, already processing or not ready.");
          return; 
      }
      
      //console.log("Generating welcome back message using context builder...");
      interruptAndCleanup(); 

      let systemPrompt = "";
      try {
          const triggerPhrase = "You are OS1. Briefly welcome the user back by knowing what is the user's name.";
          systemPrompt = await buildContextMemo(triggerPhrase); 
          //console.log("Context built for welcome message:", systemPrompt); 
          if (!systemPrompt) {
              console.warn("Context builder returned empty for welcome message, using fallback.");
              systemPrompt = "You are OS1. Briefly welcome the user back.";
          }
      } catch (buildError) {
          console.error("Error building context for welcome message:", buildError);
          toast.error("Failed to build context for greeting.");
          systemPrompt = "You are OS1. Briefly welcome the user back.";
      }

      queueMicrotask(() => {
          setIsProcessing(true);
          isProcessingRef.current = true;
          hasAutoSpoken.current = true; 

          //console.log("Using system prompt for welcome message:", systemPrompt);

          const messagesForWorker: Message[] = [
              { role: 'system', content: systemPrompt },
          ];

          setMessages([{ role: 'assistant', content: '' }]);


          setTimeout(() => { 
              if (llamaWorker.current) {
                  //console.log("Posting message type 'generate' to worker for welcome back message.");
                  llamaWorker.current.postMessage({
          type: 'generate',
          data: {
                          messages: messagesForWorker,
                          audio: null, 
                      }
                  });
      } else {
                  console.error("Llama worker not available for welcome back message.");
                  setIsProcessing(false);
                  isProcessingRef.current = false;
                  toast.error("Cannot connect to AI model worker for greeting.");
              }
          }, 50);
      });
  }, [status, interruptAndCleanup, setIsProcessing, buildContextMemo]); // Added buildContextMemo dependency


  const handleSubmit = useCallback(async (submittedText?: string) => {
 
      interruptAndCleanup();
      queueMicrotask(async () => {
        const textToSubmit = submittedText || inputRef.current;
        
        if (!textToSubmit.trim()) {
          //console.log("Not submitting: empty text (microtask)");
      return;
    }
    
        //console.log("Submitting message (microtask):", textToSubmit);
        setInput("");
        setIsProcessing(true);
        isProcessingRef.current = true;

        const userInputText = textToSubmit.trim(); 
        latestUserSubmitRef.current = userInputText;
        //console.log(`LlamaChat: Storing for memory/submit ref (using text): "${latestUserSubmitRef.current}"`);

        const audioDataForWorker = latestAudioDataRef.current;
        //console.log(`LlamaChat: Preparing worker message. Has audio data? ${!!audioDataForWorker}. Length: ${audioDataForWorker?.length ?? 'N/A'}`);
        latestAudioDataRef.current = null;

        let contextForLlama = "";
        try {
            contextForLlama = await buildContextMemo(userInputText);
        } catch (buildError) {
            console.error("Error building Llama context:", buildError);
            toast.error("Failed to process memories for context.");
            contextForLlama = "";
        }

        // --- Prepare Messages --- 
        let workerMessageContent = userInputText;
        if (audioDataForWorker) {
          workerMessageContent = `<|audio|>`;
          //console.log(`LlamaChat: Worker message content set to <|audio|> for audio input.`);
      } else {
          //console.log(`LlamaChat: Worker message content set to text: "${userInputText.substring(0,30)}..."`);
        }
        const userMessageForWorker: Message = { role: "user", content: workerMessageContent };
        const userMessageForDisplay: Message = { role: "user", content: userInputText };

        const currentMessagesForDisplay = [...messagesRef.current, userMessageForDisplay]; 
        setMessages([...currentMessagesForDisplay, { role: "assistant", content: "" }]);

        const fullHistory = [...messagesRef.current, userMessageForWorker];
        const SLIDING_WINDOW_SIZE = 10;
        let messagesForWorker = fullHistory.slice(-SLIDING_WINDOW_SIZE);
        //console.log(`LlamaChat: Sliced message history to last ${messagesForWorker.length} messages (max ${SLIDING_WINDOW_SIZE})`);

        if (contextForLlama) {
          //console.log("Prepending system prompt with context for worker...");
          messagesForWorker.unshift({ role: "system", content: contextForLlama });
        }

        setTimeout(() => {
          if (llamaWorker.current) {
            const messageType = audioDataForWorker ? "generate_with_audio" : "generate";
            const messagePayload = {
              messages: messagesForWorker,
              audio: audioDataForWorker ? audioDataForWorker : null, 
            };
            //console.log(`LlamaChat: Posting message type '${messageType}' to worker. Payload includes audio? ${!!messagePayload.audio}. Context included: ${!!contextForLlama}`);
            llamaWorker.current.postMessage({
              type: messageType,
              data: messagePayload
      });
            } else {
            console.error("Llama worker not available");
            setIsProcessing(false); 
            isProcessingRef.current = false;
            setMessages(currentMessagesForDisplay); 
            toast.error("Cannot connect to AI model worker.");
          }
        }, 50); 
      }); 
  }, [buildContextMemo, interruptAndCleanup]);

  const handleTranscriptionUpdate = useCallback((text: string) => {
    if (text) {
        //console.log("LlamaChat received transcription update (replacing input):", text);
        setInput(text);
    }
  }, []); 

  const handleSilenceSubmit = useCallback((_text: string, audioData: Float32Array | null) => {
    //console.log("LlamaChat: Silence duration met, triggering submit.");
    //console.log(`LlamaChat: Storing audio data from silence callback, length: ${audioData?.length ?? 'null'}`);
    latestAudioDataRef.current = audioData;
    handleSubmit(); 
  }, [handleSubmit]); 

  const {
    isRecording,
    transcriptionReady,
    startRecording: startRecordingWhisper,
    stopRecording: stopRecordingWhisper,
    micStream,
    error: recorderError,
  } = useWhisperRecorder({
      onTranscriptionUpdate: handleTranscriptionUpdate,
      onSilenceDetected: handleSilenceSubmit,
  });


  useEffect(() => {
    let isLoading = true; 
    const loadingInterval = setInterval(() => {
      if (!isLoading) return;
      setLoadingProgress(prev => Math.min(prev + (Math.random() * 4 + 1), 90));
    }, 300);

    llamaWorker.current = new Worker(new URL("../llama-worker.js", import.meta.url), { type: "module" });
    kokoroWorker.current = new Worker(new URL("../worker.js", import.meta.url), { type: "module" });

    const handleLlamaMessage = (e: MessageEvent) => {
      const { status, output, data, summary, error } = e.data;
      
      switch (status) {
        case "ready":
          setLlamaStatus("ready");
          setLoadingProgress(prev => Math.max(prev, 60));
          break;
        case "error":
          setLlamaStatus("error");
          setComponentError(data || "Error loading Llama model");
          clearInterval(loadingInterval);
          currentSentenceBufferRef.current = ""; 
          break;
        case "start":
          latestResponseRef.current = "";
          hasAutoSpoken.current = false;
          currentSentenceBufferRef.current = ""; 
          setMessages(prev => {
            if (prev.length > 0 && prev[prev.length - 1].role === "assistant" && prev[prev.length - 1].content === "") {
              return prev;
            }
            return [...prev, { role: "assistant", content: "" }];
          });
          break;
        case "update":
          const newToken = output; 
          if (typeof newToken === 'string') {
            currentSentenceBufferRef.current += newToken;
            latestResponseRef.current += newToken;
            updateMessages(latestResponseRef.current); 

            const sentenceEndRegex = /[.?!]/;
            if (sentenceEndRegex.test(newToken)) {
              const sentenceToSpeak = currentSentenceBufferRef.current.trim();
              if (sentenceToSpeak) {
                // console.log("Speaking sentence:", sentenceToSpeak);
                speakText(sentenceToSpeak);
                hasAutoSpoken.current = true; 
              }
              currentSentenceBufferRef.current = ""; 
            }
          }
          break;
        case "complete":
          setIsProcessing(false);

          const remainingBuffer = currentSentenceBufferRef.current.trim();
          if (remainingBuffer) {
            // console.log("Speaking final sentence fragment:", remainingBuffer);
            speakText(remainingBuffer);
            hasAutoSpoken.current = true; 
          }
          currentSentenceBufferRef.current = ""; 
          
          const finalText = output || latestResponseRef.current;
          const userInput = latestUserSubmitRef.current;
          updateMessages(finalText);
          

          const trimmedFinalText = finalText?.trim();
          if (trimmedFinalText && !hasAutoSpoken.current) {
            hasAutoSpoken.current = true;
            queueMicrotask(() => speakText(trimmedFinalText));
          }

          if (finalText?.trim() && userInput) {
            const lowerCaseFinalText = finalText.toLowerCase();
            const shouldSaveMemory = !DENIAL_PHRASES_FOR_STORAGE.some(phrase => 
              lowerCaseFinalText.includes(phrase)
            );

            if (shouldSaveMemory) {
              const SHORT_INPUT_WORD_THRESHOLD = 15;
              const MIN_DIRECT_STORE_WORD_COUNT = 1; // Don't store <= 1 word
              const wordCount = userInput.split(/\s+/).filter(Boolean).length;

              // Store directly ONLY if between 2 and 14 words (inclusive)
              if (wordCount > MIN_DIRECT_STORE_WORD_COUNT && wordCount < SHORT_INPUT_WORD_THRESHOLD) {
                  console.log(`Input is short (${wordCount} words), storing directly.`);
                  addMemory(userInput, 'user')
                    .then(() => {
                        console.log("Short user input added to memory.");
                        // Refresh viewer if open using ref
                        if (isMemoryViewerOpenRef.current) {
                            fetchMemories(); 
                        }
                    })
                    .catch((memError: unknown) => { 
                        console.error("Failed to add short user input to memory:", memError);
                        toast.error("Failed to save short memory input.");
                    });
              // Summarize if 15 words or more
              } else if (wordCount >= SHORT_INPUT_WORD_THRESHOLD) {
                 const textToSummarize = userInput; 
                 console.log(`Requesting summarization for user input (${wordCount} words):`, textToSummarize.substring(0, 100) + "...");
                 if (llamaWorker.current) {
                   llamaWorker.current.postMessage({
                     type: 'summarize',
                     data: { textToSummarize }
                   });
                 } else {
                   console.error("Llama worker not available for summarization request.");
                   toast.error("Could not save memory summary: Worker unavailable.");
                 }
              // Otherwise (0 or 1 word), skip storage
              } else {
                  console.log(`Input too short (${wordCount} words), skipping memory storage.`);
              }
            } else {
               console.log("Skipping memory save due to denial phrase.");
            }
          } else {
             console.log("Skipping memory save (no final text or user input).")
          }

          setTimeout(() => {
            latestUserSubmitRef.current = "";
            latestResponseRef.current = "";
          }, 100);
          break;

        case "summarization_start":
          //console.log("Worker started summarization process...");
          break;
          
        case "summary_complete":
          console.log("Received summary:", summary);
          if (summary && typeof summary === 'string' && summary.trim()) {
             const saveMemory = () => {
                 addMemory(summary.trim(), 'user')
                    .then(() => {
                        console.log("User input summary added to memory.");
                        // Refresh viewer if open using ref
                        if (isMemoryViewerOpenRef.current) {
                            fetchMemories();
                        }
                    })
                    .catch((memError: unknown) => { 
                        console.error("Failed to add summary to memory:", memError);
                        toast.error("Failed to save summarized memory.");
                    });
             };

            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(saveMemory, { timeout: 1000 });
            } else {
                setTimeout(saveMemory, 0);
            }
          } else {
            console.warn("Received empty or invalid summary from worker, not saving to memory.");
          }
          break;

        case "summary_error":
          console.error("Summarization failed in worker:", data || error);
          toast.error("Failed to generate memory summary.");
          break;
      }
    };

    const handleKokoroMessage = (e: MessageEvent) => {
      const { status, data, chunk, } = e.data;
      switch (status) {
        case "device": break;
        case "ready":
          setKokoroStatus("ready");
          setLoadingProgress(prev => Math.max(prev, 75));
          break;
        case "stream":
          if (chunk && chunk.audio instanceof Blob) {
            handleAudioChunk(chunk.audio);
          } else {
            console.warn("Received stream message without valid audio blob:", chunk);
          }
          break;
        case "error":
          if (ttsStartTimeRef.current !== null) {
            const endTime = performance.now();
            const duration = endTime - ttsStartTimeRef.current;
            console.error(`TTS Error after ${duration.toFixed(2)} ms`);
            ttsStartTimeRef.current = null; 
          } else {
             console.error("TTS Error: Received error message without a recorded start time.");
          }

          setAudioChunkQueue([]);
          if (isAudioPlaying && audioRef.current) {
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
              setIsAudioPlaying(false);
              if (currentAudioUrlRef.current) {
                  // console.log("Revoking URL from error handler:", currentAudioUrlRef.current);
                  URL.revokeObjectURL(currentAudioUrlRef.current);
                  currentAudioUrlRef.current = null;
              }
          }

          if (isProcessingTTS.current) {
            ttsQueue.current.shift();
            isProcessingTTS.current = false;
            setIsTTSProcessing(false);
             setTimeout(processNextTTSRequest, 100);
          } else {
            setKokoroStatus("error");
            setComponentError(data || "Error loading Kokoro model");
          }
          break;
        case "complete":
          if (ttsStartTimeRef.current !== null) {
            //const endTime = performance.now();
            //const duration = endTime - ttsStartTimeRef.current;
            //console.log(`TTS Complete: Total generation finished in ${duration.toFixed(2)} ms`); // Clarified log
            ttsStartTimeRef.current = null; 
          } else {
             //console.log("TTS Complete: Received complete message without a recorded start time.");
          }

          ttsQueue.current.shift();
          isProcessingTTS.current = false;
          setIsTTSProcessing(false);
          processNextTTSRequest(); 

          break;
      }
    };

    llamaWorker.current.addEventListener("message", handleLlamaMessage);
    kokoroWorker.current.addEventListener("message", handleKokoroMessage);

    console.log("Requesting model loads for Llama, Kokoro...");
    llamaWorker.current.postMessage({ type: "load" });
    kokoroWorker.current.postMessage({ type: "load" });

    console.log("Initiating preload for Embedding model...");
    preloadEmbeddingModel().catch((err: unknown) => { 
        console.error("Embedding model preload failed:", err);
    });

    return () => {
      isLoading = false; 
      clearInterval(loadingInterval);
      //console.log("Terminating Llama & Kokoro workers...");
      llamaWorker.current?.terminate();
      kokoroWorker.current?.terminate();
      llamaWorker.current?.removeEventListener("message", handleLlamaMessage);
      kokoroWorker.current?.removeEventListener("message", handleKokoroMessage);
      
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.onended = null; 
            audioRef.current.onerror = null; 
            audioRef.current.src = ""; 
        }
        if (currentAudioUrlRef.current) {
            URL.revokeObjectURL(currentAudioUrlRef.current);
            currentAudioUrlRef.current = null; 
      }
    };
  }, []);

  useEffect(() => {
    if (recorderError) {
        console.error("Error from useWhisperRecorder:", recorderError);
        setComponentError(recorderError);
        toast.error(`Recording Error: ${recorderError}`);
    }
  }, [recorderError]);

  useEffect(() => {
    const isReady = llamaStatus === "ready" && kokoroStatus === "ready" && transcriptionReady;
    const isError = llamaStatus === "error" || kokoroStatus === "error" || recorderError;
      
    if (isReady) {
      setLoadingProgress(100);
      setShowLoadingAnimation(true);
      const readyTimer1 = setTimeout(() => {
        setStatus("ready");
        const readyTimer2 = setTimeout(() => {
          setShowLoadingAnimation(false);
        }, 2500);
        const readyTimer3 = setTimeout(() => {
          setInputReady(true);
        }, 1300);
        return () => {
          clearTimeout(readyTimer2);
          clearTimeout(readyTimer3);
        };
      }, 1000);
      return () => clearTimeout(readyTimer1);
    } else if (isError) {
      setStatus("error");
      setLoadingProgress(prev => (prev === 100 ? 100 : 0)); 
    } else {
      setLoadingProgress(prev => (prev === 100 ? 100 : 0)); 
    }
  }, [llamaStatus, kokoroStatus, transcriptionReady, recorderError]); 

  useEffect(() => {
    if (inputReady && messages.length === 0 && !hasAutoSpoken.current && !isProcessingRef.current) {
      const visitedFlag = localStorage.getItem('os1_hasVisited');

      if (!visitedFlag) {
        //console.log("First visit detected, preparing predefined greeting.");
        const greetingText = "Welcome! I'm OS1, your conversational companion. Everything we talk about, including memories of our chat, stays right here in your browser – nothing is sent to a server, and the AI runs entirely on your machine. To help me remember you next time, what should I call you? You can type your answer or click the microphone to speak.";
        localStorage.setItem('os1_hasVisited', 'true');
        const greetingMessage: Message = { role: 'assistant', content: greetingText };
        setMessages([greetingMessage]);
        speakText(greetingText);
        hasAutoSpoken.current = true;
      } else {
        //console.log("Return visit detected, triggering LLM for welcome back message.");
        generateWelcomeBackMessage(); 
      }
    }
  }, [inputReady, messages.length, hasAutoSpoken.current, generateWelcomeBackMessage]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleAudioChunk = useCallback((chunk: Blob) => {
    setAudioChunkQueue(prev => {
      if (prev.length >= 10) {
        console.warn("Audio queue size limit reached, dropping oldest chunk");
        return [...prev.slice(1), chunk];
      }
      return [...prev, chunk];
    });
  }, []);

  useEffect(() => {
    if (!isAudioPlaying && audioChunkQueue.length > 0) {
      //console.log("Effect: Triggering playNextChunk (Queue > 0, Not Playing)");
      playNextChunk();
    }
  }, [isAudioPlaying, audioChunkQueue.length, playNextChunk]);

  // --- Handlers for Memory Viewer ---
  const fetchMemories = useCallback(async () => {
    setIsMemoryLoading(true);
    try {
      const memories = await getAllMemories();
      // Sort by timestamp descending (newest first)
      memories.sort((a, b) => b.timestamp - a.timestamp);
      setMemoryList(memories);
    } catch (err) {
      console.error("Failed to fetch memories:", err);
      toast.error("Could not load memories.");
      setMemoryList([]); // Clear list on error
    } finally {
      setIsMemoryLoading(false);
    }
  }, []);

  const toggleMemoryViewer = useCallback(async () => {
    const opening = !isMemoryViewerOpen;
    setIsMemoryViewerOpen(opening);
    if (opening) {
      // Fetch memories only when opening the viewer
      await fetchMemories();
    } else {
      // Optionally clear the list when closing to save memory,
      // or keep it cached if preferred.
      // setMemoryList([]);
    }
  }, [isMemoryViewerOpen, fetchMemories]);

  const handleDeleteMemory = useCallback(async (id: number) => {
    console.log(`Attempting to delete memory ID: ${id}`);
    try {
      await deleteMemory(id);
      toast.success("Memory deleted.");
      // Refresh the list after deletion
      await fetchMemories();
    } catch (err) {
      console.error(`Failed to delete memory ID ${id}:`, err);
      toast.error("Could not delete memory.");
    }
  }, [fetchMemories]); // Depend on fetchMemories to ensure it's up-to-date
  // --- End Memory Viewer Handlers ---

  // --- Effect to keep viewer state ref updated ---
  useEffect(() => {
    isMemoryViewerOpenRef.current = isMemoryViewerOpen;
  }, [isMemoryViewerOpen]);
  // --- End effect --- 

  return (
    <div className="os1-container">
      <OS1Animation 
        isTTSProcessing={isTTSProcessing || isProcessing} 
        showTransformation={showLoadingAnimation}
      />
      
      {status === "loading" && (
        <div className="loading-bar-container">
          <div className="loading-bar" style={{ width: `${loadingProgress}%` }}></div>
        </div>
      )}
      
      {status === "error" && (
        <div className="message error">
          <span>Error: {componentError || "Failed to load OS1"}</span>
        </div>
      )}
      
      {status === "ready" && (
        <>
          {micStream && isRecording && (
            <div className="audio-visualizer-container">
              <div className="visualizer-glow"></div>
              <div className="visualizer-inner">
                <AudioVisualizer stream={micStream} className="os1-visualizer" />
              </div>
            </div>
          )}
          
          <div className={`input-container ${inputReady ? 'ready' : ''}`}>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me anything..."
              disabled={isProcessing}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <button
              className={`memory-button ${isMemoryViewerOpen ? 'active' : ''}`} 
              onClick={toggleMemoryViewer}
              disabled={isMemoryLoading} 
              title="View Memories"
            >
              <BrainCircuit className="icon" />
            </button>
            <button 
              className={`mic-button ${isRecording ? 'recording' : ''}`}
              onClick={() => isRecording ? stopRecordingWhisper() : startRecordingWhisper()}
              disabled={!transcriptionReady}
              title={isRecording ? "Stop recording" : "Start recording"}
            >
              {isRecording ? <MicOff className="icon" /> : <Mic className="icon" />}
            </button>
            <button 
              className="send-button"
              onClick={() => handleSubmit()}
              disabled={!input.trim() || isProcessing}
            >
              <Send />
            </button>
          </div>

          <MemoryViewer
            isOpen={isMemoryViewerOpen}
            memories={memoryList}
            onDelete={handleDeleteMemory}
            isLoading={isMemoryLoading}
          />
        </>
      )}
      <div ref={messageEndRef} />
    </div>
  );
} 