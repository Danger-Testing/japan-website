'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useLocation } from '@/hooks/useLocation'

const RouteMapLeaflet = dynamic(() => import('@/components/RouteMapMapbox'), { ssr: false })

const STORIES = [
  '/ig/story_01_image_20260409_053307.jpg',
  '/ig/story_02_image_20260409_053328.jpg',
  '/ig/story_03_image_20260409_073814.jpg',
  '/ig/story_04_image_20260409_073820.jpg',
  '/ig/story_05_video_20260409_073847.mp4',
  '/ig/story_06_image_20260409_073853.jpg',
  '/ig/story_07_image_20260409_073906.jpg',
  '/ig/story_08_image_20260409_074000.jpg',
  '/ig/story_09_image_20260409_090353.jpg',
  '/ig/story_10_image_20260409_143305.jpg',
  '/ig/story_11_image_20260409_143339.jpg',
  '/ig/story_12_video_20260409_143354.mp4',
  '/ig/story_13_video_20260409_143411.mp4',
  '/ig/story_14_image_20260409_143421.jpg',
  '/ig/story_15_video_20260409_143452.mp4',
  '/ig/story_16_image_20260409_143537.jpg',
  '/ig/story_17_image_20260409_143557.jpg',
  '/ig/story_18_image_20260409_143745.jpg',
  '/ig/story_19_video_20260409_144231.mp4',
  '/ig/story_20_image_20260409_150146.jpg',
]

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

function nearestSegmentPoint(
  ix: number, iy: number,
  pts: { x: number; y: number }[]
): { x: number; y: number; d2: number } {
  let bestX = pts[0].x, bestY = pts[0].y, bestD2 = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, ay = pts[i].y
    const bx = pts[i + 1].x, by = pts[i + 1].y
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((ix - ax) * dx + (iy - ay) * dy) / len2)) : 0
    const cx = ax + t * dx, cy = ay + t * dy
    const d2 = (ix - cx) ** 2 + (iy - cy) ** 2
    if (d2 < bestD2) { bestD2 = d2; bestX = cx; bestY = cy }
  }
  return { x: bestX, y: bestY, d2: bestD2 }
}

function findNearestPhoto(
  clientX: number, clientY: number,
  pan: { x: number; y: number },
  zoom: number,
  svgMeta: { scale: number; tx: number; ty: number },
  routePts: { x: number; y: number }[],
  photoZones: { x: number; y: number; src: string; caption: string }[]
): { src: string; caption: string } | null {
  if (svgMeta.scale === 0 || routePts.length < 2 || photoZones.length === 0) return null
  const ix = ((clientX - pan.x) / zoom - svgMeta.tx) / svgMeta.scale
  const iy = ((clientY - pan.y) / zoom - svgMeta.ty) / svgMeta.scale
  const { x: bestX, y: bestY, d2: bestD2 } = nearestSegmentPoint(ix, iy, routePts)
  if (bestD2 >= 120 * 120) return null
  let nearest: (typeof photoZones)[0] | null = null, nearestD2 = Infinity
  for (const z of photoZones) {
    const d2 = (bestX - z.x) ** 2 + (bestY - z.y) ** 2
    if (d2 < nearestD2) { nearestD2 = d2; nearest = z }
  }
  return nearest ? { src: nearest.src, caption: nearest.caption } : null
}


const ABOUT_SLIDES = [
  { key: 'toni',  title: 'Toni',  text: "Toni, AKA El Toro, is one of the fastest street cyclists in the world. From the Bronx, NYC, he has been riding fixed-gear bikes for 15 years, building a reputation as an elite alleycat racer, known for his impeccable style and bespoke bicycles. He has won multiple alleycat races, including Monster Track NYC in 2023. Over time, he started falling in love with the idea of ultra-distance riding, drawn especially to doing it on a fixed-gear bike for the added challenge.\n\nDuring his last time in Japan, he heard about this race and decided to go for it with three days of preparation. He finished in 28h 9mins, with the last 80 miles ridden in freezing rain at 34°F. After crossing the line, Toni heard about a local legend: a rider named Yuki had done the same route, brakeless on a fixed gear, in 22 hours.\n\nEl Toro has wanted to reattempt it ever since. This time, he believes he is capable of going under 24 hours, he just needs the weather to align." },
  { key: 'route', title: 'Route', text: 'The Tokyo to Osaka Cannonball is one of Japan\'s most iconic efforts, very rarely attempted in a single day and almost never on a fixed-gear bike. The route follows Route 1 across Japan, starting or ending at the Japan National Highway Milestone in Nihonbashi, Chuo Ward. It covers 318 miles (512 km) with over 11,000 feet of elevation.\n\nThe most challenging parts of the ride are the climb up Hakone Mountain, the relentless red lights, and some confusing turns along the way.' },
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
    const fmt = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
    setTime(fmt())
    const id = setInterval(() => setTime(fmt()), 1000)
    return () => clearInterval(id)
  }, [])
  return time
}

function useLiveHeartRate() {
  const [bpm, setBpm] = useState(72)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      setBpm(prev => {
        // 80% chance: stay the same; 20% chance: drift by 1
        const delta = Math.random() < 0.2 ? (Math.random() < 0.5 ? -1 : 1) : 0
        return Math.max(65, Math.min(80, prev + delta))
      })
      t = setTimeout(tick, 3000 + Math.random() * 4000)
    }
    t = setTimeout(tick, 3000 + Math.random() * 4000)
    return () => clearTimeout(t)
  }, [])
  return bpm
}

function useCountdownToEST4am() {
  const [label, setLabel] = useState('')
  useEffect(() => {
    const getTarget = () => {
      // 4am EST = UTC-5, so 09:00 UTC
      const now = new Date()
      const t = new Date(now)
      t.setUTCHours(9, 0, 0, 0)
      if (t.getTime() <= now.getTime()) t.setUTCDate(t.getUTCDate() + 1)
      return t
    }
    const update = () => {
      const diff = getTarget().getTime() - Date.now()
      if (diff <= 0) { setLabel('00:00:00'); return }
      const s = Math.floor(diff / 1000)
      const days = Math.floor(s / 86400)
      const h = Math.floor((s % 86400) / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      const hms = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      setLabel(days > 0 ? `${days}d ${hms}` : hms)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])
  return label
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
  const panRef = useRef({ x: 0, y: 0 })
  const routePtsRef = useRef<{ x: number; y: number }[]>([])
  const photoZonesRef = useRef<{ x: number; y: number; src: string; caption: string }[]>([])
  const svgMetaRef = useRef({ scale: 0, tx: 0, ty: 0 })
  const isTouchOnRoute = useRef(false)
  const touchDidMove = useRef(false)
  const [elapsed, setElapsed] = useState('')
  const [welcomeOpen, setWelcomeOpen] = useState(true)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [aboutSlide, setAboutSlide] = useState(0)
  const clockTime = useCurrentTime()
  const tps = useMemo(() => buildTPS(CONTROL_POINTS), [])
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [fanText, setFanText] = useState('')
  const [fanSent, setFanSent] = useState(false)

  const [communityPhotos, setCommunityPhotos] = useState<Array<{
    id: number; lat: number; lng: number; locality: string; administrative_area: string; caption: string | null
  }>>([])
  useEffect(() => {
    fetch('/api/community-photos')
      .then(r => r.json())
      .then(data => setCommunityPhotos(data.results ?? []))
      .catch(() => {})
  }, [])

  // Sample ~300 evenly-spaced points along the full route; map each to its
  // nearest community photo. This gives dense interactive coverage across the
  // whole route rather than only 46 sparse hotspots.
  const photoZones = useMemo(() => {
    if (routePts.length < 2 || communityPhotos.length === 0) return []
    const step = Math.max(1, Math.floor(routePts.length / 300))
    const zones: { x: number; y: number; src: string; caption: string }[] = []
    for (let i = 0; i < routePts.length; i += step) {
      const [lat, lon] = routeGeo[i]
      let bestIdx = 0, bestD2 = Infinity
      for (let j = 0; j < communityPhotos.length; j++) {
        const dlat = communityPhotos[j].lat - lat
        const dlon = communityPhotos[j].lng - lon
        const d2 = dlat * dlat + dlon * dlon
        if (d2 < bestD2) { bestD2 = d2; bestIdx = j }
      }
      const p = communityPhotos[bestIdx]
      zones.push({
        x: routePts[i].x,
        y: routePts[i].y,
        src: `https://ridewithgps.com/photos/${p.id}/large.jpg`,
        caption: [p.locality, p.administrative_area].filter(Boolean).join(', '),
      })
    }
    return zones
  }, [routePts, routeGeo, communityPhotos])
  const [photoPopup, setPhotoPopup] = useState<{ src: string; caption: string } | null>(null)
  const [storyIdx, setStoryIdx] = useState(0)

  // Auto-advance images; videos self-advance via onEnded
  useEffect(() => {
    if (STORIES[storyIdx].endsWith('.mp4')) return
    const t = setTimeout(() => setStoryIdx(i => (i + 1) % STORIES.length), 5000)
    return () => clearTimeout(t)
  }, [storyIdx])
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
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

  // Elapsed ride time ticker — always running; uses sessionStart when live, hardcoded global start otherwise
  const GLOBAL_START = 1775862765599
  useEffect(() => {
    const startTime = (isLive && sessionStart !== null) ? sessionStart : GLOBAL_START
    const update = () => {
      const totalSecs = Math.floor((Date.now() - startTime) / 1000)
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

  // Measure container once for the standalone route SVG layer
  useEffect(() => {
    if (!containerRef.current) return
    setContainerSize({ w: containerRef.current.clientWidth, h: containerRef.current.clientHeight })
  }, [])

  // Replicate SVG viewBox xMidYMid slice: maps image coords → container pixels
  const svgScale = containerSize.w && containerSize.h
    ? Math.max(containerSize.w / IMG_W, containerSize.h / IMG_H)
    : 0
  const svgTx = (containerSize.w - IMG_W * svgScale) / 2
  const svgTy = (containerSize.h - IMG_H * svgScale) / 2

  // Keep refs current so static touch handlers can read latest values
  useEffect(() => { panRef.current = pan }, [pan])
  useEffect(() => { routePtsRef.current = routePts }, [routePts])
  useEffect(() => { photoZonesRef.current = photoZones }, [photoZones])
  useEffect(() => { svgMetaRef.current = { scale: svgScale, tx: svgTx, ty: svgTy } }, [svgScale, svgTx, svgTy])

  // Convert cursor screen position → nearest point on route (image coords)
  const routeCursorDot = useMemo(() => {
    if (!cursorPos || routePts.length < 2 || svgScale === 0) return null
    const ix = ((cursorPos.x - pan.x) / zoom - svgTx) / svgScale
    const iy = ((cursorPos.y - pan.y) / zoom - svgTy) / svgScale
    const { x, y, d2 } = nearestSegmentPoint(ix, iy, routePts)
    return d2 < 80 * 80 ? { x, y } : null
  }, [cursorPos, routePts, pan, zoom, svgTx, svgTy, svgScale])

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
        const photo = findNearestPhoto(
          e.touches[0].clientX, e.touches[0].clientY,
          panRef.current, zoomRef.current, svgMetaRef.current,
          routePtsRef.current, photoZonesRef.current
        )
        if (photo) {
          isTouchOnRoute.current = true
          touchDidMove.current = false
          isDragging.current = false
          setPhotoPopup(photo)
        } else {
          isTouchOnRoute.current = false
          isDragging.current = true
          setPhotoPopup(null)
          lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
          lastPinchDist.current = null
        }
      } else if (e.touches.length === 2) {
        isTouchOnRoute.current = false
        isDragging.current = false
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        lastPinchDist.current = Math.hypot(dx, dy)
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const { clientWidth: w, clientHeight: h } = el
      if (e.touches.length === 1 && isTouchOnRoute.current) {
        touchDidMove.current = true
        const photo = findNearestPhoto(
          e.touches[0].clientX, e.touches[0].clientY,
          panRef.current, zoomRef.current, svgMetaRef.current,
          routePtsRef.current, photoZonesRef.current
        )
        if (photo) setPhotoPopup(photo)
      } else if (e.touches.length === 1 && isDragging.current) {
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

    const onTouchEnd = () => {
      if (isTouchOnRoute.current && touchDidMove.current) setPhotoPopup(null)
      isTouchOnRoute.current = false
      isDragging.current = false
      lastPinchDist.current = null
    }

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

  // Track cursor globally so photo-circle pointer-events don't create dead zones
  useEffect(() => {
    const onMove = (e: MouseEvent) => setCursorPos({ x: e.clientX, y: e.clientY })
    const onLeave = () => setCursorPos(null)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
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
  const onMouseLeaveContainer = () => { isDragging.current = false }

  const first = routePts[0]
  const last  = routePts[routePts.length - 1]

  const totalKm = routeCumDist[routeCumDist.length - 1] ?? null
  const remainingKm = isLive && riderKm !== null && totalKm !== null ? totalKm - riderKm : null
  const TARGET_KMH = 25
  const etaHours = (km: number) => {
    const h = Math.floor(km / TARGET_KMH)
    const m = Math.round((km / TARGET_KMH - h) * 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const kmDisplay = remainingKm !== null ? etaHours(remainingKm) : totalKm !== null ? etaHours(totalKm) : '--'
  const timeDisplay = isLive && elapsed ? elapsed : clockTime

  return (
    <>
    <div
      ref={containerRef}
      className="fixed inset-0 select-none overflow-hidden cursor-grab active:cursor-grabbing touch-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeaveContainer}
    >
      <div style={{ position: 'absolute', inset: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', willChange: 'transform' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/japan.png"
        alt="Map of Japan"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        draggable={false}
      />

      </div>
    </div>

    {/* Route SVG — fixed layer above photo popup (z-20 > z-10).
        Replicates viewBox xMidYMid slice via nested <g> transforms so
        image-space coords stay correct without being inside the pan/zoom div. */}
    {(routePts.length > 1 || bikerPos) && svgScale > 0 && (
      <svg className="fixed inset-0 z-20 pointer-events-none" style={{ width: '100%', height: '100%' }}>
        {/* outer g = pan/zoom (mirrors the CSS transform on the map div) */}
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* inner g = viewBox xMidYMid slice mapping */}
          <g transform={`translate(${svgTx},${svgTy}) scale(${svgScale})`}>
            {/* Photo hit areas — dense route sampling so the whole route is interactive */}
            {photoZones.map((p, i) => (
              <circle
                key={i}
                cx={p.x} cy={p.y} r={40}
                fill="transparent"
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onMouseEnter={() => setPhotoPopup({ src: p.src, caption: p.caption })}
                onMouseLeave={() => setPhotoPopup(null)}
                onClick={e => {
                  e.stopPropagation()
                  setPhotoPopup(prev => prev?.src === p.src && prev?.caption === p.caption ? null : { src: p.src, caption: p.caption })
                }}
              />
            ))}
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
            {routeCursorDot && (
              <circle cx={routeCursorDot.x} cy={routeCursorDot.y} r={12} fill="red" />
            )}
          </g>
        </g>
      </svg>
    )}

    <div className="fixed top-3 left-3 sm:top-8 sm:left-8 z-30 flex flex-col items-start gap-2">
      <div className="pointer-events-none flex flex-col">
        <span className="text-[#02F7F7] font-bold text-2xl sm:text-5xl lg:text-6xl uppercase opacity-50" style={{ fontFamily: 'Times New Roman, serif' }}>{timeDisplay}</span>
      </div>
      {/* Story viewer — mobile only, under clock */}
      <div
        className="sm:hidden relative w-[70px] cursor-pointer overflow-hidden"
        style={{ aspectRatio: '9/16' }}
        onClick={() => setStoryIdx(i => (i + 1) % STORIES.length)}
      >
        {STORIES[storyIdx].endsWith('.mp4') ? (
          <video key={storyIdx} src={STORIES[storyIdx]} className="w-full h-full object-cover" autoPlay muted playsInline onEnded={() => setStoryIdx(i => (i + 1) % STORIES.length)} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={storyIdx} src={STORIES[storyIdx]} alt="" className="w-full h-full object-cover" draggable={false} />
        )}
        <div className="absolute top-1 left-1 right-1 flex gap-0.5 pointer-events-none">
          {STORIES.map((_, i) => (
            <div key={i} className={`h-0.5 flex-1 rounded-full ${i === storyIdx ? 'bg-white' : 'bg-white/30'}`} />
          ))}
        </div>
      </div>
    </div>

    {/* new.png — left side, centered between top clock and bottom screen widget */}
    <div className="hidden sm:flex fixed left-3 sm:left-8 z-30 pointer-events-none items-center top-[72px] bottom-[104px] sm:top-[136px] sm:bottom-[234px] lg:top-[150px] lg:bottom-[312px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/new.png" alt="" className="w-20 sm:w-32 lg:w-44" draggable={false} />
    </div>

    <div className="fixed top-3 right-3 sm:top-8 sm:right-8 z-30 flex flex-col items-end gap-2">
      <div className="pointer-events-none text-[#02F7F7] font-bold text-right uppercase flex flex-col items-end opacity-50" style={{ fontFamily: 'Times New Roman, serif' }}>
        <span className="text-2xl sm:text-5xl lg:text-6xl leading-none">tokyo</span>
        <span className="text-xl sm:text-4xl lg:text-5xl leading-none -mt-1">{kmDisplay} to osaka</span>
      </div>
    </div>

    {/* Story viewer — desktop only, vertically centered on right */}
    <div className="hidden sm:flex fixed right-8 top-1/2 -translate-y-1/2 z-30 flex-col items-end gap-2">
      <div
        className="relative w-[150px] lg:w-[200px] cursor-pointer overflow-hidden"
        style={{ aspectRatio: '9/16' }}
        onClick={() => setStoryIdx(i => (i + 1) % STORIES.length)}
      >
        {STORIES[storyIdx].endsWith('.mp4') ? (
          <video
            key={storyIdx}
            src={STORIES[storyIdx]}
            className="w-full h-full object-cover"
            autoPlay muted playsInline
            onEnded={() => setStoryIdx(i => (i + 1) % STORIES.length)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={storyIdx} src={STORIES[storyIdx]} alt="" className="w-full h-full object-cover" draggable={false} />
        )}
        <div className="absolute top-1 left-1 right-1 flex gap-0.5 pointer-events-none">
          {STORIES.map((_, i) => (
            <div key={i} className={`h-0.5 flex-1 rounded-full ${i === storyIdx ? 'bg-white' : 'bg-white/30'}`} />
          ))}
        </div>
      </div>
      <p className="text-[#02F7F7] font-bold uppercase opacity-50 text-sm lg:text-base tracking-wide pointer-events-none" style={{ fontFamily: 'Times New Roman, serif' }}>
        live from ig
      </p>
    </div>

    <button onClick={() => { playSound(); setAboutOpen(true) }} className="fixed bottom-0 right-0 z-30 cursor-pointer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/menu.png" alt="Menu" className="w-36 sm:w-60 lg:w-80" draggable={false} />
    </button>

    {welcomeOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer" onClick={() => { playSound(); setWelcomeOpen(false) }}>
        <div className="absolute inset-0 bg-black/60" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/intro.png" alt="" className="relative w-auto object-contain" style={{ height: '50dvh' }} draggable={false} />
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
                <p className="text-sm mt-4 opacity-50 leading-relaxed font-bold uppercase text-black" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>
                  49x16 Ratio. Wheels are Weis Wheels to Raketa Hubs. Bars are Enve stem, aero bars, TT Bars clip ons. Chainring and Cranks by Sugino Japan. Selle Italia 3D Saddle. Full MAAP kit.
                </p>
              </>
            ) : ABOUT_SLIDES[aboutSlide].key === 'route' && routeGeo.length > 1 ? (
              <>
                <RouteMapLeaflet routeGeo={routeGeo} />
                <p className="text-sm mt-4 opacity-50 leading-relaxed font-bold uppercase text-black" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>{ABOUT_SLIDES[aboutSlide].text}</p>
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/toni.png" alt="Toni" className="w-1/3 sm:w-1/2 mx-auto mt-4 sm:mt-8" draggable={false} />
                <p className="text-sm mt-4 opacity-50 leading-relaxed font-bold uppercase text-black" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>{ABOUT_SLIDES[aboutSlide].text}</p>
                <a href="https://www.instagram.com/shogun.toro?igsh=MWs0dWc5NnRyazY3ZA==" target="_blank" rel="noopener noreferrer" className="block mt-4 text-sm opacity-50 hover:opacity-100 transition-opacity font-bold uppercase text-black" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>@shogun.toro ↗</a>
              </>
            )}
          </div>
          {/* spacer reserves the card's bottom border area — height % is of card height */}
          <div className="flex-shrink-0" style={{ height: '8%' }} />
        </div>
      </div>
    )}

    <div className="fixed bottom-0 left-0 z-30 pointer-events-none w-[200px] sm:w-[360px] lg:w-[480px] [container-type:inline-size]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/screen.png" alt="" className="w-full" />
      <div className="absolute flex items-center justify-center text-[#02F7F7] font-bold tracking-wider uppercase overflow-hidden opacity-50" style={{ fontFamily: 'Times New Roman, serif', fontSize: '13cqw',
        left:   `${273 / 1014 * 100}%`,
        top:    `${525 / 659 * 100}%`,
        width:  `${(904 - 273) / 1014 * 100}%`,
        height: `${(631 - 525) / 659 * 100}%`,
      }}>
        {elapsed || '00:00:00'}
      </div>
    </div>


    {/* Photo popup — z-10 so route SVG (z-20) renders above it */}
    {photoPopup && (
      <div className="fixed inset-0 z-10 pointer-events-none overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoPopup.src} alt="" className="w-full h-full object-cover opacity-50" draggable={false} />
        {photoPopup.caption && (
          <p className="absolute bottom-0 left-0 right-0 text-white text-sm px-4 py-2 opacity-60 uppercase tracking-wide" style={{ fontFamily: 'Times New Roman, serif' }}>
            {photoPopup.caption}
          </p>
        )}
      </div>
    )}

    {/* Fan post drawing canvas — centered at bottom */}
    <div className="hidden sm:flex fixed bottom-2 left-1/2 -translate-x-1/2 z-30 flex-col items-center gap-1">
      <div className="relative" onMouseDown={e => e.stopPropagation()}>
        <input
          type="text"
          value={fanText}
          onChange={e => setFanText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.form?.requestSubmit() }}
          placeholder="write something for toni..."
          className="block w-[280px] px-3 py-2 text-sm font-bold uppercase outline-none bg-transparent placeholder:text-[rgba(2,247,247,0.5)]"
          style={{
            fontFamily: 'Times New Roman, serif',
            color: 'rgba(2,247,247,0.5)',
            border: '1.5px solid rgba(2,247,247,0.5)',
            caretColor: 'rgba(2,247,247,0.5)',
          }}
        />
        <button
          className="absolute bottom-1.5 right-2 text-[10px] uppercase tracking-wide font-bold cursor-pointer"
          style={{ fontFamily: 'Times New Roman, serif', color: 'rgba(2,247,247,0.5)' }}
          onClick={async () => {
            if (!fanText.trim()) return
            await fetch('/api/fan-sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: fanText.trim() }) })
            setFanText('')
            setFanSent(true)
            setTimeout(() => setFanSent(false), 2000)
          }}
        >{fanSent ? 'sent!' : 'send'}</button>
      </div>
    </div>

</>
  )
}
