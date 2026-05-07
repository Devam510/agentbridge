/**
 * platform/companion/local-llm.ts — Module 7: Local GPU-Accelerated AI
 *
 * WHY: Uses the user's NVIDIA RTX 1650 (CUDA) to run a quantized Llama model
 * at ~1s/response with zero API costs and zero cloud data leakage.
 * Falls back to null if model is not downloaded — callers handle fallback to OpenAI.
 *
 * Model: Llama-3.2-3B-Instruct-Q4_K_M.gguf (~2GB VRAM, fits RTX 1650)
 */

import * as path from 'path';
import * as fs from 'fs';

const MODEL_DIR = path.resolve('./models');
const MODEL_NAME = 'Llama-3.2-3B-Instruct-Q4_K_M.gguf';
const MODEL_PATH = path.join(MODEL_DIR, MODEL_NAME);

interface LocalLLM {
  infer: (prompt: string, systemPrompt?: string) => Promise<string>;
  isLoaded: () => boolean;
}

let llmInstance: LocalLLM | null = null;
let loadAttempted = false;

/**
 * Lazily load the local LLM on first call.
 * Returns null if model file doesn't exist yet (user hasn't downloaded it).
 */
export async function getLocalLLM(): Promise<LocalLLM | null> {
  if (loadAttempted) return llmInstance;
  loadAttempted = true;

  if (!fs.existsSync(MODEL_PATH)) {
    console.log(`[LocalLLM] Model not found at ${MODEL_PATH}. Run: npx tsx scripts/download-model.ts`);
    return null;
  }

  try {
    // Dynamic import so the server doesn't crash if node-llama-cpp isn't installed
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

    console.log('[LocalLLM] Loading model with CUDA (RTX 1650)...');
    const llama = await getLlama({
      gpu: 'cuda', // Use NVIDIA GPU
    });

    const model = await llama.loadModel({ modelPath: MODEL_PATH });
    const context = await model.createContext({ contextSize: 2048 });

    console.log('[LocalLLM] ✅ Model loaded successfully on GPU!');

    llmInstance = {
      isLoaded: () => true,
      infer: async (prompt: string, systemPrompt?: string): Promise<string> => {
        const session = new LlamaChatSession({
          contextSequence: context.getSequence(),
          systemPrompt: systemPrompt ?? 'You are a helpful AI assistant for web automation tasks.',
        });

        const response = await session.prompt(prompt, {
          maxTokens: 512,
          temperature: 0.1,
        });

        // Clean up sequence to free GPU memory
        session.dispose();
        return response;
      },
    };

    return llmInstance;
  } catch (err: any) {
    console.warn('[LocalLLM] Failed to load model:', err.message);
    loadAttempted = false; // Allow retry
    return null;
  }
}

export function isLocalLLMLoaded(): boolean {
  return llmInstance !== null && llmInstance.isLoaded();
}
