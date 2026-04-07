#!/usr/bin/env node
/**
 * Generate a seamlessly-tiling ocean background tile matching japan.png's style.
 * Uses the actual japan.png as a visual reference via multimodal input.
 * Usage: OPENROUTER_API_KEY=sk-or-... node scripts/gen-tile.mjs
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
if (!OPENROUTER_API_KEY) {
  console.error('Error: OPENROUTER_API_KEY environment variable is not set.')
  process.exit(1)
}

// Read the reference image and encode it
const refImage = readFileSync(join(ROOT, 'public', 'japan.png'))
const refB64 = refImage.toString('base64')
const refDataUrl = `data:image/png;base64,${refB64}`

const prompt = `Look at the ocean/sea water in the corners and edges of this map image. That dark teal/cyan water surface is the only thing I want.

Generate a single square image that is 100% filled with that ocean water texture.

Requirements:
- Perfectly match the exact colors: dark teal (#027581) base with subtle cyan highlights, exactly as it appears in the corners of the reference
- Match the same subtle grainy/painterly surface quality of the water in the reference
- Absolutely NO land, NO green areas, NO coastlines, NO islands — pure ocean only
- NO grid lines, NO borders, NO labels, NO text, NO overlays
- Single square image, nothing else`

console.log('Requesting image from OpenRouter (google/gemini-3.1-flash-image-preview) with reference image…')

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://japan-website.local',
  },
  body: JSON.stringify({
    model: 'google/gemini-3.1-flash-image-preview',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: refDataUrl },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
    modalities: ['image'],
  }),
})

if (!res.ok) {
  console.error(`HTTP ${res.status}:`, await res.text())
  process.exit(1)
}

const json = await res.json()

const msg = json?.choices?.[0]?.message
let b64 = null

if (msg?.images?.length) {
  const raw = msg.images[0].image_url?.url ?? msg.images[0].data ?? msg.images[0].url ?? null
  b64 = raw?.startsWith('data:') ? raw.split(',')[1] : raw
} else if (Array.isArray(msg?.content)) {
  for (const part of msg.content) {
    if (part.type === 'image_url') {
      const url = part.image_url?.url ?? ''
      b64 = url.startsWith('data:') ? url.split(',')[1] : url
      break
    }
  }
}

if (!b64) {
  console.error('Could not find image data. Response:', JSON.stringify(json, (k, v) =>
    typeof v === 'string' && v.length > 200 ? `[string len=${v.length}]` : v, 2))
  process.exit(1)
}

const buf = Buffer.from(b64, 'base64')
const outPath = join(ROOT, 'public', 'japan-bg-tile.png')
writeFileSync(outPath, buf)
console.log(`Saved → public/japan-bg-tile.png  (${(buf.length / 1024).toFixed(0)} KB)`)
