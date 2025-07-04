# AshOS - Local Conversational AI

This project is an attempt to recreate some of the experience "AshOS" from the movie 'Her', running entirely locally in your browser using transformers.js and featuring direct speech-to-text interaction. All the while trying to keep it lightweight at a whopping ~2GB of model downloads (which is then cached for future use).

It was a tough challenge trying to get a small 1B model to work in such a usable way without it hallucinating too much, but giving it guided prompts and a memory bank helped tremedously. **Still, this model is subject to saying nonsense at times and is far from perfect.**

### Try it out: https://huggingface.co/spaces/webml-community/ashos
*(initially, you will download the required models, so loading will be a bit longer at first. Look at your browser's network tab in the console if you really want to see the models being fetched)*

## Demo: Testing AshOS's ability to remember my name


https://github.com/user-attachments/assets/525c56ec-ba87-4adf-bdcd-2e1ddf90f8b2


## Features

*   **AI Model Options:** 
    *   **OpenAI Integration (Default):** Uses OpenAI's GPT-4o-mini for fast, high-quality responses. Requires an OpenAI API key.
    *   **Local Models:** Uses the [onnx-community/ultravox-v0_5-llama-3_2-1b-ONNX](https://huggingface.co/onnx-community/ultravox-v0_5-llama-3_2-1b-ONNX) model for completely local operation.
*   **Speech-to-text Conversation:** 
    *   **With OpenAI:** Uses Whisper for transcription, then sends text to OpenAI's API
    *   **With Local Models:** Uses the Ultravox model which accepts both audio and text input directly
*   **Parallel Transcription (for Display/Memory):** While your voice drives the conversation, the whisper-base model runs in parallel to transcribe your speech. This transcription is used for:
    *   Displaying your words on the screen for visual feedback.
    *   Storing the text representation of what you said in the vector storage. 
    *   *Note: This transcription is **not** sent to the LLM for response generation.*
*   **Client-Side Memory:** Stores interactions between the user and assistant using vector storage in the browser's IndexedDB. Contextually relevant memories are automatically retrieved and injected into the LLM's system prompt. 
*   **Privacy Options:**
    *   **OpenAI Mode:** Conversations are sent to OpenAI's servers for processing
    *   **Local Mode:** All conversation data, memory storage, and AI model processing happen locally on your machine. Nothing is sent to external servers.
*   **Small Footprint (Local Mode):** Requires approximately 2GB of model downloads on first launch (cached for subsequent visits).
*   **Proactive Greetings:** Welcomes users differently on their very first visit versus return visits, attempting to recall the user's name (if previously mentioned) by querying the memory bank.


## What I used

*   **Frontend:** React, Vite, TypeScript, Tailwind CSS
*   **Models**
    *   **Core LLM & Audio Input:** [onnx-community/ultravox-v0_5-llama-3_2-1b-ONNX](https://huggingface.co/onnx-community/ultravox-v0_5-llama-3_2-1b-ONNX)
    *   **Speech-to-Text (For Display/Memory):** [onnx-community/whisper-base](https://huggingface.co/onnx-community/whisper-base)
    *   **Text-to-Speech:** [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
    *   **Embeddings (Memory):** [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
*   **Memory:** In-browser vector storage using basic cosine similarity search 



## How It Works

1.  **Model Loading:** Transformers.js downloads and initializes the Ultravox Llama 3.2 1b, Whisper-Base, Kokoro-TTS, and all-MiniLM-L6-v2 models.
2.  **Interaction (Voice Example):**
    *   User clicks the microphone and speaks.
    *   Audio data is captured.
    *   *In Parallel:* Whisper processes the audio to generate text for display and later memory storage.
    *   The captured audio data is prepared for the Ultravox Llama 3.2 model.
3.  **Context Building:**
    *   An embedding is generated from the Whisper transcription
    *   The local memory (in IndexedDB) is searched for relevant past interactions.
    *   A system prompt is constructed containing persona instructions and relevant memory excerpts.
    *  Top 5 memories are fetched, and are only fetched if they meet the minimum similarity threshold score of 0.28. If not, they get filtered out.
4.  **Ultravox Llama 3.2 1b Processing:**
    *   The system prompt (with context) and a special `<|audio|>` token are sent to the Ultravox processor.
    *   The processor combines the text prompt embeddings with embeddings generated from the captured *audio data*.
    *   The combined embeddings are fed to the Ultravox LLM to generate a text response stream.
5.  **TTS Generation:** The generated text stream is sent to Kokoro TTS to generate audio chunks, which is then played back for the user to hear.
7.  **Memory Storage:** User input (Whisper transcription or typed text) is processed. If it's short (e.g., < 15 words), the raw text is stored directly. If longer, it's sent to the LLM model for summarization (64 tokens max). Then, it is converted into an embedding and stored with the 'user' role in IndexedDB for future context retrieval.


## Getting Started

### Option 1: Using OpenAI (Recommended for easier setup)

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/callbacked/ashos
    cd ashos
    ```
2.  **Install dependencies:**
    ```bash
    npm i
    ```
3.  **Set up OpenAI API key:**
    - Copy the `.env` file and add your OpenAI API key:
    ```bash
    cp .env .env.local
    ```
    - Edit `.env.local` and replace `your_openai_api_key_here` with your actual OpenAI API key
    - You can get an API key from [OpenAI's platform](https://platform.openai.com/api-keys)
4.  **Run the development server:**
    ```bash
    npm run dev
    ```
5.  Open your browser and go to `http://localhost:5173`.

### Option 2: Using Local Models (Original setup)

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/callbacked/ashos
    cd ashos
    ```
2.  **Install dependencies:**
    ```bash
    npm i
    ```
3.  **Switch to local models:**
    - Rename `src/ash-worker.js` to `src/ash-worker.js.backup`
    - Rename `src/llama-worker.js` to `src/llama-worker.js.backup`
    - Rename `src/llama-worker.js.backup` to `src/llama-worker.js`
    - Update `src/components/AshChat.tsx` to use `llama-worker.js` instead of `ash-worker.js`
4.  **Run the development server:**
    ```bash
    npm run dev
    ```
5.  Open your browser and go to `http://localhost:5173`.

The first time you load the application with local models, the necessary AI models (~2GB) will be downloaded and cached by your browser. This might take a few moments. Subsequent loads should be faster.

## Notes

*   Ensure you have a modern browser supporting WebGPU like any Chromium based browser.
*   Performance depends heavily on your machine's hardware.

## Acknowledgements

This project is essentially an amalgamation of the hard work put in by these people orders of magnitude smarter than me, I would like to thank them in no particular order.

*   **Siyoung Park:** For the original MIT Licensed AshOS loading animation concept [on CodePen](https://codepen.io/psyonline/pen/yayYWg).

*   **ONNX Community:** For providing the ONNX version of all of the models used here

*   **Xenova** For their work on Transformers.js, and reference to their LLM worker code in [transformers.js-examples](https://github.com/huggingface/transformers.js-examples)

*   **Spike Jonze and the creators of the movie 'Her':** For the original inspiration. A very bleak movie to watch 12 years later lmao.


