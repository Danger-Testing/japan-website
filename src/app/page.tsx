'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useLocation } from '@/hooks/useLocation'

const RouteMapLeaflet = dynamic(() => import('@/components/RouteMapLeaflet'), { ssr: false })

const CONTROL_POINTS = [
  { lat: 43.0618, lon: 141.3545, x: 2128, y:  285 },
  { lat: 38.2688, lon: 140.8721, x: 2294, y:  898 },
  { lat: 35.6762, lon: 139.6503, x: 2188, y: 1312 },
  { lat: 34.6937, lon: 135.5023, x: 1771, y: 1577 },
  { lat: 34.3853, lon: 132.4553, x: 1571, y: 1620 },
  { lat: 33.5902, lon: 130.4017, x: 1298, y: 1782 },
]

const IMG_W = 3840
const IMG_H = 2160

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

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Route photo pins — add your own: { lat, lng, src: '/your-photo.jpg', caption: '...' }
const PHOTO_WAYPOINTS = [
  { lat: 35.6847, lng: 139.7746, src: '/toni.png',   caption: 'Nihonbashi, Tokyo — Start' },
  { lat: 35.2323, lng: 139.0615, src: '/japan.jpeg', caption: 'Hakone Mountain' },
  { lat: 34.9756, lng: 138.3828, src: '/japan.jpeg', caption: 'Shizuoka' },
  { lat: 35.1709, lng: 136.8815, src: '/japan.jpeg', caption: 'Nagoya' },
  { lat: 34.6704, lng: 135.5003, src: '/toni.png',   caption: 'Osaka — Finish' },
]

const ABOUT_SLIDES = [
  { key: 'toni',  title: 'Toni',  text: "I'm Toni, I've been riding fixed gear bikes for 15 years, I became an alleycat racer extraordinaire who started falling in love with the idea of doing ultra distance rides, some on fixed gear bikes for the added challenge. I did this Tokyo to Osaka ride in December 2024 after hearing about it while I was in Japan, I prepared for 3 days last minute, and went for the ride on a whim. It took me 28 hours 19 minutes. The last 80 miles of that ride was in freezing 34 degrees F rain, which was where all my elapsed time went. Upon finishing, I hear The Legend in Japan has it that a guy named Yuki did the cannonball on a brakeless fixed gear in 22 hours. Since then I've wanted to reattempt it, I think I am capable of getting an under 22 hours time, I just need the weather to align with me." },
  { key: 'route', title: 'Route', text: 'The Iconic Tokyo Osaka ride is very rarely attempted in one day, let alone on a fixed gear bike. It goes across Route 1 in Japan. The start or ending is Japan National Highway Milestone in Nihonbashi, Chuo Ward! … and has an elevation of 11k+ feet…. The most challenging part of the ride is climbing Hakone Mountain, all the red lights, and some confusing turns here and there.' },
  { key: 'bike',  title: 'Bike',  text: 'Placeholder — about the bike.' },
] as const

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
  const [routeGeo, setRouteGeo] = useState<[number, number][]>([])
  const [routeCumDist, setRouteCumDist] = useState<number[]>([])
  const [zoom, setZoom] = useState(2.5)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const lastPinchDist = useRef<number | null>(null)
  const zoomRef = useRef(2.5)
  const [elapsed, setElapsed] = useState('')
  const [welcomeOpen, setWelcomeOpen] = useState(true)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [aboutSlide, setAboutSlide] = useState(0)
  const clockTime = useCurrentTime()
  const tps = useMemo(() => buildTPS(CONTROL_POINTS), [])
  const photoPositions = useMemo(
    () => PHOTO_WAYPOINTS.map(wp => ({ ...wp, ...evalTPS(tps, wp.lat, wp.lng) })),
    [tps]
  )
  const [photoPopup, setPhotoPopup] = useState<{ src: string; caption: string; x: number; y: number } | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playSound = () => {
    if (!audioRef.current) audioRef.current = new Audio('/swoosh.mp3')
    audioRef.current.currentTime = 0
    audioRef.current.play()
  }

  const { location, isLive, sessionStart } = useLocation()

  // Map rider lat/lng → image pixel position
  const riderPos = useMemo(() => {
    if (!location || !isLive) return null
    return evalTPS(tps, location.lat, location.lng)
  }, [location, isLive, tps])

  // Biker indicator: live position or Tokyo start
  const bikerPos = useMemo(() => {
    if (riderPos) return riderPos
    if (routePts.length > 0) return routePts[0]
    return null
  }, [riderPos, routePts])

  // Distance along route to nearest point to rider
  const riderKm = useMemo(() => {
    if (!location || !isLive || routeGeo.length === 0) return null
    let minDist = Infinity
    let minIdx = 0
    for (let i = 0; i < routeGeo.length; i++) {
      const d = haversineKm(location.lat, location.lng, routeGeo[i][0], routeGeo[i][1])
      if (d < minDist) { minDist = d; minIdx = i }
    }
    return routeCumDist[minIdx] ?? null
  }, [location, isLive, routeGeo, routeCumDist])

  // Elapsed ride time ticker
  useEffect(() => {
    if (!isLive || sessionStart === null) { setElapsed(''); return }
    const update = () => {
      const totalSecs = Math.floor((Date.now() - sessionStart) / 1000)
      const h = Math.floor(totalSecs / 3600)
      const m = Math.floor((totalSecs % 3600) / 60)
      const s = totalSecs % 60
      setElapsed(
        h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      )
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [isLive, sessionStart])

  useEffect(() => {
    fetch('/japan.gpx')
      .then(r => r.text())
      .then(text => {
        const raw = parseGpx(text)
        const pts = raw.map(([lat, lon]) => evalTPS(tps, lat, lon))
        setRoutePts(pts)
        setRouteGeo(raw)
        const cumDist: number[] = [0]
        for (let i = 1; i < raw.length; i++) {
          cumDist.push(cumDist[i - 1] + haversineKm(raw[i-1][0], raw[i-1][1], raw[i][0], raw[i][1]))
        }
        setRouteCumDist(cumDist)
      })
  }, [tps])

  const clamp = (x: number, y: number, z: number, w: number, h: number) => ({
    x: Math.max(-(w * (z - 1)), Math.min(0, x)),
    y: Math.max(-(h * (z - 1)), Math.min(0, y)),
  })

  // Start zoomed in on the Tokyo–Osaka route midpoint; lower zoom on portrait/mobile.
  // On a phone (< 640px wide) the landscape Japan image is heavily cropped by objectFit
  // to fill the portrait viewport, so zoom 2.5 would show only a tiny slice of the route.
  useEffect(() => {
    if (!containerRef.current) return
    const { clientWidth: w, clientHeight: h } = containerRef.current
    const z = w < 640 ? 1.5 : w >= 1024 ? 2.0 : 2.5
    zoomRef.current = z
    setZoom(z)
    // Route midpoint is ~51.5% across, ~66.8% down in the image
    setPan(clamp(w / 2 - 0.515 * w * z, h / 2 - 0.668 * h * z, z, w, h))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // All pointer/touch handlers use imperative addEventListener with { passive: false }
  // so e.preventDefault() is honoured. React's synthetic onTouchMove is passive by
  // default on modern browsers, which silently ignores preventDefault and lets the
  // browser's native pan/pinch take over instead of our map controls.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { clientWidth: w, clientHeight: h } = el
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const prevZoom = zoomRef.current
      const next = Math.max(1, Math.min(10, prevZoom * (e.deltaY < 0 ? 1.02 : 0.98)))
      zoomRef.current = next
      setZoom(next)
      setPan(prev => {
        const ratio = next / prevZoom
        return clamp(mx - (mx - prev.x) * ratio, my - (my - prev.y) * ratio, next, w, h)
      })
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDragging.current = true
        lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        lastPinchDist.current = null
      } else if (e.touches.length === 2) {
        isDragging.current = false
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        lastPinchDist.current = Math.hypot(dx, dy)
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const { clientWidth: w, clientHeight: h } = el
      if (e.touches.length === 1 && isDragging.current) {
        const dx = e.touches[0].clientX - lastPos.current.x
        const dy = e.touches[0].clientY - lastPos.current.y
        lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        setPan(p => clamp(p.x + dx, p.y + dy, zoomRef.current, w, h))
      } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        const dist = Math.hypot(dx, dy)
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const prevZoom = zoomRef.current
        const next = Math.max(1, Math.min(10, prevZoom * (dist / lastPinchDist.current)))
        zoomRef.current = next
        setZoom(next)
        setPan(prev => {
          const ratio = next / prevZoom
          return clamp(mx - (mx - prev.x) * ratio, my - (my - prev.y) * ratio, next, w, h)
        })
        lastPinchDist.current = dist
      }
    }

    const onTouchEnd = () => { isDragging.current = false; lastPinchDist.current = null }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onMouseDown = (e: React.MouseEvent) => { isDragging.current = true; lastPos.current = { x: e.clientX, y: e.clientY }; setPhotoPopup(null) }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return
    const { clientWidth: w, clientHeight: h } = containerRef.current
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setPan(p => clamp(p.x + dx, p.y + dy, zoomRef.current, w, h))
  }
  const onMouseUp = () => { isDragging.current = false }

  const first = routePts[0]
  const last  = routePts[routePts.length - 1]

  const totalKm = routeCumDist[routeCumDist.length - 1] ?? null
  const remainingKm = isLive && riderKm !== null && totalKm !== null ? totalKm - riderKm : null
  const toMi = (km: number) => (km * 0.621371).toFixed(1)
  const kmDisplay = remainingKm !== null ? `${toMi(remainingKm)}mi` : totalKm !== null ? `${toMi(totalKm)}mi` : '--'
  const timeDisplay = isLive && elapsed ? elapsed : clockTime

  return (
    <>
    <div
      ref={containerRef}
      className="fixed inset-0 select-none overflow-hidden cursor-grab active:cursor-grabbing touch-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div style={{ position: 'absolute', inset: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', willChange: 'transform' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/japan.png"
        alt="Map of Japan"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        draggable={false}
      />

      {(routePts.length > 1 || bikerPos) && (
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          viewBox={`0 0 ${IMG_W} ${IMG_H}`}
          preserveAspectRatio="xMidYMid slice"
          className="pointer-events-none"
        >
          {routePts.length > 1 && (
            <>
              <polyline
                points={routePts.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none" stroke="white" strokeWidth={8}
                strokeLinejoin="round" strokeLinecap="round"
                strokeDasharray="40 30"
              />
              <circle cx={first.x} cy={first.y} r={18} fill="white" />
              <circle cx={last.x}  cy={last.y}  r={18} fill="white" />
            </>
          )}
          {bikerPos && (
            <image href="/biking.png" x={bikerPos.x - 80} y={bikerPos.y - 160} width={160} height={159} />
          )}
          {routePts.length > 1 && (
            <>
              <image href="/tokyo.png" x={first.x + 30} y={first.y - 60} width={280} height={64} />
              <image href="/osaka.png" x={last.x - 282} y={last.y - 33} width={252} height={66} />
            </>
          )}
          {/* Photo pins — circular thumbnail markers along the route */}
          <defs>
            {photoPositions.map((_, i) => (
              <clipPath key={i} id={`photo-clip-${i}`}>
                <circle cx={0} cy={0} r={38} />
              </clipPath>
            ))}
          </defs>
          {photoPositions.map((p, i) => (
            <g
              key={i}
              transform={`translate(${p.x}, ${p.y})`}
              style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onMouseEnter={e => {
                const rect = (e.currentTarget as SVGGElement).getBoundingClientRect()
                setPhotoPopup({ src: p.src, caption: p.caption, x: rect.left + rect.width / 2, y: rect.top })
              }}
              onMouseLeave={() => setPhotoPopup(null)}
              onClick={e => {
                e.stopPropagation()
                const rect = (e.currentTarget as SVGGElement).getBoundingClientRect()
                setPhotoPopup(prev => prev?.src === p.src && prev?.caption === p.caption ? null : { src: p.src, caption: p.caption, x: rect.left + rect.width / 2, y: rect.top })
              }}
            >
              {/* white border ring */}
              <circle r={46} fill="white" opacity={0.95} />
              {/* photo thumbnail clipped to circle */}
              <image href={p.src} x={-38} y={-38} width={76} height={76} clipPath={`url(#photo-clip-${i})`} preserveAspectRatio="xMidYMid slice" />
              {/* cyan accent ring */}
              <circle r={46} fill="none" stroke="#02F7F7" strokeWidth={5} opacity={0.8} />
            </g>
          ))}
        </svg>
      )}
      </div>
    </div>

    <div className="fixed top-4 left-4 sm:top-8 sm:left-8 pointer-events-none text-[#02F7F7] font-bold text-4xl sm:text-5xl lg:text-6xl uppercase opacity-50" style={{ fontFamily: 'Times New Roman, serif' }}>
      {timeDisplay}
    </div>

    <div className="fixed top-4 right-4 sm:top-8 sm:right-8 pointer-events-none text-[#02F7F7] font-bold text-right uppercase flex flex-col items-end opacity-50" style={{ fontFamily: 'Times New Roman, serif' }}>
      <span className="text-4xl sm:text-5xl lg:text-6xl leading-none">tokyo</span>
      <span className="text-3xl sm:text-4xl lg:text-5xl leading-none -mt-1">{kmDisplay} to osaka</span>
    </div>

    <button onClick={() => { playSound(); setAboutOpen(true) }} className="fixed bottom-0 right-0 cursor-pointer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/menu.png" alt="Menu" className="w-44 sm:w-60 lg:w-80" draggable={false} />
    </button>

    {welcomeOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60" onClick={() => { playSound(); setWelcomeOpen(false) }} />
        <div className="relative flex" style={{ height: '80dvh' }}>
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/side1.png" alt="" className="h-full block" draggable={false} />
            <button
              onClick={() => { playSound(); setWelcomeOpen(false) }}
              className="absolute bottom-6 left-[45%] -translate-x-1/2 z-10 w-fit px-8 sm:px-12 py-3 bg-black text-white uppercase tracking-widest text-sm hover:bg-black/80 transition-colors cursor-pointer"
              style={{ fontFamily: 'Times New Roman, serif' }}
            >
              Enter
            </button>
          </div>
          <div className="relative hidden sm:block" style={{ marginLeft: '-3.5%' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/side2.png" alt="" className="h-full block" draggable={false} />
          </div>
        </div>
      </div>
    )}

    {aboutOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60" onClick={() => { playSound(); setAboutOpen(false) }} />
        <div className="relative text-black flex flex-col" style={{ backgroundImage: 'url(/card.png)', backgroundSize: '100% 100%', aspectRatio: '3/4', maxHeight: '90dvh', height: 'min(70dvh, 70vw * 4 / 3)' }}>
          {/* decorative arrow overlays — span full card, non-interactive */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/arrow1.png" alt="" className="absolute inset-0 w-full h-full pointer-events-none z-10" draggable={false} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/arrow2.png" alt="" className="absolute inset-0 w-full h-full pointer-events-none z-10" draggable={false} />
          {/* nav buttons — always above scroll content */}
          <button onClick={() => { playSound(); setAboutSlide(s => (s + ABOUT_SLIDES.length - 1) % ABOUT_SLIDES.length) }} className="absolute cursor-pointer z-20" style={{ left: '9%', top: '7%', width: '14%', height: '10%' }} />
          <button onClick={() => { playSound(); setAboutSlide(s => (s + 1) % ABOUT_SLIDES.length) }} className="absolute cursor-pointer z-20" style={{ right: '8%', top: '7%', width: '14%', height: '10%' }} />
          {/* title — never scrolls */}
          <div className="flex-shrink-0 px-4 sm:px-7 lg:px-10" style={{ paddingTop: '11%' }}>
            <h2 className="font-bold text-3xl sm:text-4xl lg:text-5xl uppercase mb-3 text-center text-white" style={{ fontFamily: 'Times New Roman, serif' }}>{ABOUT_SLIDES[aboutSlide].title}</h2>
          </div>
          {/* scrollable body — only text/images scroll */}
          <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-7 lg:px-10">
            {ABOUT_SLIDES[aboutSlide].key === 'bike' ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/bike.png" alt="Bike" className="w-1/2 sm:w-2/3 mx-auto mt-4 sm:mt-8" draggable={false} />
                <p className="text-sm mt-4 opacity-50 leading-relaxed" style={{ fontFamily: 'Times New Roman, serif' }}>
                  49x16 Ratio. Wheels are Weis Wheels to Raketa Hubs. Bars are Enve stem, aero bars, TT Bars clip ons. Chainring and Cranks by Sugino Japan. Selle Italia 3D Saddle. Full MAAP kit.
                </p>
              </>
            ) : ABOUT_SLIDES[aboutSlide].key === 'route' && routeGeo.length > 1 ? (
              <>
                <RouteMapLeaflet routeGeo={routeGeo} />
                <p className="text-sm mt-4 opacity-50 leading-relaxed" style={{ fontFamily: 'Times New Roman, serif' }}>{ABOUT_SLIDES[aboutSlide].text}</p>
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/toni.png" alt="Toni" className="w-1/3 sm:w-1/2 mx-auto mt-4 sm:mt-8" draggable={false} />
                <p className="text-sm mt-4 opacity-50 leading-relaxed" style={{ fontFamily: 'Times New Roman, serif' }}>{ABOUT_SLIDES[aboutSlide].text}</p>
                <a href="https://www.instagram.com/shogun.toro?igsh=MWs0dWc5NnRyazY3ZA==" target="_blank" rel="noopener noreferrer" className="block mt-4 text-sm opacity-50 hover:opacity-100 transition-opacity" style={{ fontFamily: 'Times New Roman, serif' }}>@shogun.toro ↗</a>
              </>
            )}
          </div>
          {/* spacer reserves the card's bottom border area — height % is of card height */}
          <div className="flex-shrink-0" style={{ height: '8%' }} />
        </div>
      </div>
    )}

    <div className="fixed bottom-0 left-0 pointer-events-none w-[260px] sm:w-[360px] lg:w-[480px] [container-type:inline-size]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/screen.png" alt="" className="w-full" />
      {/* Screen zone corners in image px (1014×659): x1=273 y1=525 x2=904 y2=631 */}
      <div className="absolute flex items-center justify-center text-[#02F7F7] font-bold tracking-wider uppercase overflow-hidden opacity-50" style={{ fontFamily: 'Times New Roman, serif', fontSize: '13cqw',
        left:   `${273 / 1014 * 100}%`,
        top:    `${525 / 659 * 100}%`,
        width:  `${(904 - 273) / 1014 * 100}%`,
        height: `${(631 - 525) / 659 * 100}%`,
      }}>
        {elapsed || '00:00:00'}
      </div>
    </div>

    {/* Photo popup — shown on hover (desktop) or tap (mobile) */}
    {photoPopup && (
      <div
        className="fixed z-40 pointer-events-none"
        style={{ left: photoPopup.x, top: photoPopup.y, transform: 'translate(-50%, calc(-100% - 18px))' }}
      >
        <div className="bg-black/90 rounded overflow-hidden shadow-2xl border border-white/10" style={{ width: 220 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoPopup.src} alt="" className="w-full object-cover" style={{ maxHeight: 160 }} draggable={false} />
          {photoPopup.caption && (
            <p className="text-white text-xs px-3 py-2 opacity-60 uppercase tracking-wide" style={{ fontFamily: 'Times New Roman, serif' }}>
              {photoPopup.caption}
            </p>
          )}
        </div>
        {/* downward arrow */}
        <div className="mx-auto w-fit" style={{ borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: '8px solid rgba(0,0,0,0.9)' }} />
      </div>
    )}

</>
  )
}
