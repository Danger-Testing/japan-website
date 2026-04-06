'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const CONTROL_POINTS = [
  { lat: 43.0618, lon: 141.3545, x: 1666, y:  645 },
  { lat: 38.2688, lon: 140.8721, x: 1953, y: 1688 },
  { lat: 35.6762, lon: 139.6503, x: 1774, y: 2485 },
  { lat: 34.6937, lon: 135.5023, x: 1002, y: 2983 },
  { lat: 34.3853, lon: 132.4553, x:  617, y: 3035 },
  { lat: 33.5902, lon: 130.4017, x:  151, y: 3319 },
]

const IMG_W = 2709
const IMG_H = 4029

function tpsKernel(r2: number) {
  return r2 < 1e-10 ? 0 : r2 * Math.log(r2)
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const f = M[row][col] / M[col][col]
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

function buildTPS(pts: typeof CONTROL_POINTS) {
  const n = pts.length
  const sz = n + 3
  const A: number[][] = Array.from({ length: sz }, () => new Array(sz).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = pts[i].lon - pts[j].lon
      const dy = pts[i].lat - pts[j].lat
      A[i][j] = tpsKernel(dx * dx + dy * dy)
    }
    A[i][n] = 1; A[i][n+1] = pts[i].lon; A[i][n+2] = pts[i].lat
    A[n][i] = 1; A[n+1][i] = pts[i].lon; A[n+2][i] = pts[i].lat
  }
  const sx = solveLinear(A, [...pts.map(p => p.x), 0, 0, 0])
  const sy = solveLinear(A, [...pts.map(p => p.y), 0, 0, 0])
  return {
    pts: pts.map(p => ({ lon: p.lon, lat: p.lat })),
    wx: sx.slice(0, n), ax: sx.slice(n),
    wy: sy.slice(0, n), ay: sy.slice(n),
  }
}

function evalTPS(tps: ReturnType<typeof buildTPS>, lat: number, lon: number) {
  let x = tps.ax[0] + tps.ax[1] * lon + tps.ax[2] * lat
  let y = tps.ay[0] + tps.ay[1] * lon + tps.ay[2] * lat
  for (let i = 0; i < tps.pts.length; i++) {
    const dx = lon - tps.pts[i].lon
    const dy = lat - tps.pts[i].lat
    const phi = tpsKernel(dx * dx + dy * dy)
    x += tps.wx[i] * phi
    y += tps.wy[i] * phi
  }
  return { x, y }
}

function parseGpx(text: string): [number, number][] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const pts: [number, number][] = []
  doc.querySelectorAll('trkpt, rtept, wpt').forEach(el => {
    const lat = parseFloat(el.getAttribute('lat') ?? '')
    const lon = parseFloat(el.getAttribute('lon') ?? '')
    if (!isNaN(lat) && !isNaN(lon)) pts.push([lat, lon])
  })
  return pts
}

function useCurrentTime() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setTime(fmt())
    const id = setInterval(() => setTime(fmt()), 1000)
    return () => clearInterval(id)
  }, [])
  return time
}

export default function MapPage() {
  const [routePts, setRoutePts] = useState<{ x: number; y: number }[]>([])
  const [riderPos, setRiderPos] = useState<{ x: number; y: number } | null>(null)
  const [transform, setTransform] = useState({ zoom: 1, panX: 0, panY: 0 })
  const time = useCurrentTime()
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const minZoomRef = useRef(0.1)
  const tps = useMemo(() => buildTPS(CONTROL_POINTS), [])

  useEffect(() => {
    if (!containerRef.current) return
    const cW = containerRef.current.clientWidth
    const cH = containerRef.current.clientHeight
    const zoom = Math.max(1, cH * IMG_W / (cW * IMG_H))
    minZoomRef.current = cH * IMG_W / (cW * IMG_H)
    const panX = (cW - cW * zoom) / 2
    const panY = (cH - cW * (IMG_H / IMG_W) * zoom) / 2
    setTransform({ zoom, panX, panY })
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/location')
    es.onmessage = (e) => {
      try {
        const loc = JSON.parse(e.data) as { lat: number; lon: number }
        setRiderPos(evalTPS(tps, loc.lat, loc.lon))
      } catch {}
    }
    return () => es.close()
  }, [tps])

  useEffect(() => {
    fetch('/japan.gpx')
      .then(r => r.text())
      .then(text => {
        const raw = parseGpx(text)
        const pts = raw.map(([lat, lon]) => evalTPS(tps, lat, lon))
        setRoutePts(pts)

        if (pts.length === 0 || !containerRef.current) return
        const cW = containerRef.current.clientWidth
        const cH = containerRef.current.clientHeight
        const zoom = Math.max(1, cH * IMG_W / (cW * IMG_H))

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (const p of pts) {
          if (p.x < minX) minX = p.x
          if (p.x > maxX) maxX = p.x
          if (p.y < minY) minY = p.y
          if (p.y > maxY) maxY = p.y
        }
        const cx = (minX + maxX) / 2
        const cy = (minY + maxY) / 2
        const scale = cW / IMG_W
        setTransform({
          zoom,
          panX: cW / 2 - cx * scale * zoom,
          panY: cH / 2 - cy * scale * zoom,
        })
      })
  }, [tps])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const minZoom = rect.height * IMG_W / (rect.width * IMG_H)
      setTransform(prev => {
        const factor = e.deltaY > 0 ? 0.95 : 1.05
        const newZoom = Math.max(minZoom, Math.min(20, prev.zoom * factor))
        if (newZoom <= minZoom) {
          return {
            zoom: minZoom,
            panX: (rect.width - rect.width * minZoom) / 2,
            panY: 0,
          }
        }
        return {
          zoom: newZoom,
          panX: mx - (mx - prev.panX) * (newZoom / prev.zoom),
          panY: my - (my - prev.panY) * (newZoom / prev.zoom),
        }
      })
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTransform(prev => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }))
  }
  const onMouseUp = () => { isDragging.current = false }

  const first = routePts[0]
  const last  = routePts[routePts.length - 1]

  return (
    <>
    <div
      ref={containerRef}
      className="w-full overflow-hidden cursor-grab active:cursor-grabbing select-none" style={{ height: '100dvh', backgroundColor: '#027581' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div
        style={{
          transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom})`,
          transformOrigin: '0 0',
          willChange: 'transform',
          width: '100vw',
          position: 'relative',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/japan.png"
          alt="Map of Japan"
          style={{ width: '100%', display: 'block' }}
          draggable={false}
        />

        {(routePts.length > 1 || riderPos) && (
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            viewBox={`0 0 ${IMG_W} ${IMG_H}`}
            preserveAspectRatio="none"
            className="pointer-events-none"
          >
            {routePts.length > 1 && (
              <>
                <polyline
                  points={routePts.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke="white" strokeWidth={16}
                  strokeLinejoin="round" strokeLinecap="round"
                  strokeDasharray="40 30"
                />
                <circle cx={first.x} cy={first.y} r={28} fill="#22c55e" stroke="white" strokeWidth={9} />
                <circle cx={last.x}  cy={last.y}  r={28} fill="#ef4444" stroke="white" strokeWidth={9} />
              </>
            )}
            {riderPos && (
              <>
                <circle cx={riderPos.x} cy={riderPos.y} r={32} fill="none" stroke="#f97316" strokeWidth={8}>
                  <animate attributeName="r" values="32;70;32" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0;0.9" dur="1.8s" repeatCount="indefinite" />
                </circle>
                <circle cx={riderPos.x} cy={riderPos.y} r={28} fill="#f97316" stroke="white" strokeWidth={10} />
              </>
            )}
          </svg>
        )}
      </div>
    </div>

    {/* Top-left: current time */}
    <div className="fixed top-8 left-8 pointer-events-none text-white font-sans font-bold text-5xl uppercase ">
      {time}
    </div>

    {/* Top-right: distance */}
    <div className="fixed top-8 right-8 pointer-events-none text-white font-sans font-bold text-5xl uppercase ">
      10km
    </div>

    {/* Bottom-right: about */}
    <div className="fixed bottom-8 right-8 pointer-events-none text-white font-sans font-bold text-5xl uppercase ">
      about
    </div>

    <div className="fixed bottom-12 left-0 pointer-events-none w-[384px] [container-type:inline-size]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/screen.png" alt="" className="w-full" />
      {/* Screen zone corners in image px (1014×659): x1=273 y1=525 x2=904 y2=631 */}
      <div className="absolute flex items-center justify-center text-white font-serif font-bold italic tracking-wider uppercase overflow-hidden" style={{ fontSize: '14cqw',
        left:   `${273 / 1014 * 100}%`,
        top:    `${525 / 659 * 100}%`,
        width:  `${(904 - 273) / 1014 * 100}%`,
        height: `${(631 - 525) / 659 * 100}%`,
      }}>
        osaka
      </div>
    </div>

</>
  )
}
