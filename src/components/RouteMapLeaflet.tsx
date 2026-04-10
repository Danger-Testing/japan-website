'use client'

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'

interface Props {
  routeGeo: [number, number][]
}

export default function RouteMapMapbox({ routeGeo }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || routeGeo.length === 0 || mapRef.current) return

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!
    const coords = routeGeo.map(([lat, lon]) => [lon, lat] as [number, number])

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      interactive: true,
    })
    mapRef.current = map

    map.on('load', () => {
      map.resize()

      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {},
        },
      })

      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#f97316', 'line-width': 3, 'line-dasharray': [2, 1.5] },
      })

      const makeDot = () => {
        const el = document.createElement('div')
        el.style.cssText = 'width:12px;height:12px;border-radius:50%;background:transparent;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.3)'
        return el
      }
      new mapboxgl.Marker({ element: makeDot() }).setLngLat(coords[0]).addTo(map)
      new mapboxgl.Marker({ element: makeDot() }).setLngLat(coords[coords.length - 1]).addTo(map)

      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(coords[0], coords[0])
      )

      map.fitBounds(bounds, { padding: 10, duration: 0 })
    })

    return () => { map.remove(); mapRef.current = null }
  }, [routeGeo])

  return (
    <div className="w-full mt-10 relative" style={{ height: '30dvh' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <a
        href="https://ridewithgps.com/routes/54558564"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-2 left-2 z-10 bg-white/90 text-black text-xs font-bold px-2 py-1 rounded shadow"
      >
        View on RideWithGPS ↗
      </a>
    </div>
  )
}
