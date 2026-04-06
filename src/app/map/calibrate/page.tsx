'use client'

import { useState } from 'react'

const CITIES = [
  { name: 'Sapporo',   lat: 43.0618, lon: 141.3545, hint: 'Far north — Hokkaido island' },
  { name: 'Sendai',    lat: 38.2688, lon: 140.8721, hint: 'Northeast Honshu coast' },
  { name: 'Tokyo',     lat: 35.6762, lon: 139.6503, hint: 'East-center, largest city' },
  { name: 'Osaka',     lat: 34.6937, lon: 135.5023, hint: 'Central-west Honshu' },
  { name: 'Hiroshima', lat: 34.3853, lon: 132.4553, hint: 'Southwest Honshu' },
  { name: 'Fukuoka',   lat: 33.5902, lon: 130.4017, hint: 'Far southwest — Kyushu island' },
]

const IMG_W = 2709
const IMG_H = 4029

interface ControlPoint {
  name: string; lat: number; lon: number; x: number; y: number
}

export default function CalibratePage() {
  const [points, setPoints] = useState<ControlPoint[]>([])
  const [copied, setCopied] = useState(false)

  const current = CITIES[points.length]
  const done = points.length >= CITIES.length

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (done) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xFrac = (e.clientX - rect.left) / rect.width
    const yFrac = (e.clientY - rect.top) / rect.height
    const city = CITIES[points.length]
    setPoints(prev => [...prev, {
      name: city.name, lat: city.lat, lon: city.lon,
      x: Math.round(xFrac * IMG_W),
      y: Math.round(yFrac * IMG_H),
    }])
  }

  const json = JSON.stringify(
    points.map(({ name, lat, lon, x, y }) => ({ name, lat, lon, x, y })),
    null, 2
  )

  function copy() { navigator.clipboard.writeText(json); setCopied(true) }
  function reset() { setPoints([]); setCopied(false) }

  return (
    <div className="min-h-screen bg-zinc-900 text-white flex flex-col items-center py-10 px-4 gap-4">
      <h1 className="text-2xl font-semibold">Map Calibration</h1>

      <div className="w-full max-w-xl bg-zinc-800 border border-zinc-700 rounded-lg p-4 text-sm">
        {!done ? (
          <>
            <p className="text-teal-400 font-semibold text-base mb-1">
              {points.length + 1}/{CITIES.length} — click <span className="text-white font-bold">{current.name}</span> on the map
            </p>
            <p className="text-zinc-400 text-xs mb-2">{current.hint}</p>
            {points.length > 0 && (
              <p className="text-zinc-500 text-xs">Done: {points.map(p => p.name).join(' · ')}</p>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-green-400 font-semibold">All 6 points — paste this to Claude:</p>
            <pre className="text-xs bg-zinc-900 rounded p-3 overflow-x-auto text-zinc-300 leading-relaxed">{json}</pre>
            <div className="flex gap-2">
              <button onClick={copy} className="rounded bg-teal-600 hover:bg-teal-500 px-4 py-2 text-sm font-medium">
                {copied ? '✓ Copied!' : 'Copy JSON'}
              </button>
              <button onClick={reset} className="rounded bg-zinc-700 hover:bg-zinc-600 px-4 py-2 text-sm">
                Start over
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        className="relative w-full max-w-xl cursor-crosshair rounded-xl overflow-hidden shadow-2xl select-none"
        onClick={handleClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/japan.png" alt="Map of Japan" className="w-full block" draggable={false} />

        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${IMG_W} ${IMG_H}`}
          preserveAspectRatio="none"
        >
          {points.map(pt => (
            <g key={pt.name}>
              <circle cx={pt.x} cy={pt.y} r={55} fill="#f59e0b" stroke="white" strokeWidth={18} />
              <text x={pt.x + 75} y={pt.y + 45} fontSize={220} fontWeight="700"
                fill="white" stroke="rgba(0,0,0,0.75)" strokeWidth={55} paintOrder="stroke">
                {pt.name}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}
