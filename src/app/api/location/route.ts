import type { NextRequest } from 'next/server'

interface Location {
  lat: number
  lon: number
  speed?: number
  heading?: number
  timestamp: number
}

let latestLocation: Location | null = null
const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()
const encoder = new TextEncoder()

export async function GET() {
  let ctrl: ReadableStreamDefaultController<Uint8Array>

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller
      subscribers.add(controller)
      if (latestLocation) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(latestLocation)}\n\n`))
      }
    },
    cancel() {
      subscribers.delete(ctrl)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function POST(request: NextRequest) {
  if (!process.env.LOCATION_API_KEY) {
    return Response.json({ error: 'LOCATION_API_KEY not configured on server' }, { status: 500 })
  }
  if (request.headers.get('x-api-key') !== process.env.LOCATION_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { lat: number; lon: number; speed?: number; heading?: number }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { lat, lon, speed, heading } = body
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return Response.json({ error: 'lat and lon must be numbers' }, { status: 400 })
  }

  latestLocation = { lat, lon, speed, heading, timestamp: Date.now() }

  const data = encoder.encode(`data: ${JSON.stringify(latestLocation)}\n\n`)
  const dead: ReadableStreamDefaultController<Uint8Array>[] = []
  for (const sub of subscribers) {
    try {
      sub.enqueue(data)
    } catch {
      dead.push(sub)
    }
  }
  dead.forEach(sub => subscribers.delete(sub))

  return Response.json({ ok: true, viewers: subscribers.size })
}
