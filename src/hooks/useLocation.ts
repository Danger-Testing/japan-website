import { useEffect, useRef, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '@/lib/firebase'

export interface RiderLocation {
  lat: number
  lng: number
  speed: number | null  // m/s, may be null if unavailable
  timestamp: number
}

export function useLocation() {
  const [location, setLocation] = useState<RiderLocation | null>(null)
  const [isLive, setIsLive] = useState(false)
  const [sessionStart, setSessionStart] = useState<number | null>(null)
  const wasLive = useRef(false)

  useEffect(() => {
    const unsubLocation = onValue(ref(db, 'location'), (snap) => {
      setLocation(snap.val())
    })
    const unsubSession = onValue(ref(db, 'session'), (snap) => {
      const active: boolean = snap.val()?.active ?? false
      setIsLive(active)
      if (active && !wasLive.current) {
        setSessionStart(Date.now())
      }
      if (!active) {
        setSessionStart(null)
      }
      wasLive.current = active
    })
    return () => { unsubLocation(); unsubSession() }
  }, [])

  return { location, isLive, sessionStart }
}
