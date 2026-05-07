/**
 * scripts/download-model.ts — Module 7: One-time model downloader
 *
 * WHY: Downloads the quantized Llama 3.2 3B model (~2GB) from HuggingFace
 * into the local models/ directory for GPU inference.
 *
 * Run with: npx tsx scripts/download-model.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const MODEL_DIR = path.resolve('./models');
const MODEL_NAME = 'Llama-3.2-3B-Instruct-Q4_K_M.gguf';
const MODEL_PATH = path.join(MODEL_DIR, MODEL_NAME);

// HuggingFace direct download URL for the quantized model
const MODEL_URL =
  'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf';

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(MODEL_DIR)) {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
    }

    if (fs.existsSync(dest)) {
      console.log(`✅ Model already exists at: ${dest}`);
      resolve();
      return;
    }

    console.log(`\n📥 Downloading ${MODEL_NAME}...`);
    console.log(`   From: ${url}`);
    console.log(`   To:   ${dest}`);
    console.log(`   Size: ~2.0 GB\n`);

    const file = fs.createWriteStream(dest);
    let downloaded = 0;
    let total = 0;
    let lastLog = Date.now();

    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }

      total = parseInt(response.headers['content-length'] ?? '0', 10);

      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        const now = Date.now();
        // Log progress every 2 seconds
        if (now - lastLog > 2000) {
          const pct = total > 0 ? ((downloaded / total) * 100).toFixed(1) : '?';
          process.stdout.write(`\r   Progress: ${formatBytes(downloaded)} / ${formatBytes(total)} (${pct}%)`);
          lastLog = now;
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`\n\n✅ Model downloaded successfully!`);
        console.log(`   Path: ${dest}`);
        console.log(`\n🚀 Your RTX 1650 will now handle AI inference locally.`);
        console.log(`   Restart the companion server to activate GPU mode.\n`);
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest); // Clean partial download
      reject(err);
    });

    file.on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

// Main
(async () => {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   AgentBridge — Local GPU AI Model Downloader    ║');
  console.log('║   Model: Llama 3.2 3B Instruct (Q4_K_M)         ║');
  console.log('║   GPU:   NVIDIA RTX 1650 (CUDA)                  ║');
  console.log('╚══════════════════════════════════════════════════╝');

  try {
    await downloadFile(MODEL_URL, MODEL_PATH);
  } catch (err: any) {
    console.error('\n❌ Download failed:', err.message);
    console.error('   Check your internet connection and try again.');
    process.exit(1);
  }
})();
