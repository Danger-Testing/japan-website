'use client'
import dynamic from 'next/dynamic'

const MapPage = dynamic(() => import('./MapPage'), { ssr: false })

export default function MapPageLoader() {
  return <MapPage />
}
