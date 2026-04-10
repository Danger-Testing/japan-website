import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const { message } = await req.json()
  if (!message || typeof message !== 'string') {
    return Response.json({ error: 'invalid' }, { status: 400 })
  }
  const { error } = await supabase
    .from('fan_signs')
    .insert({ message: message.slice(0, 280) })
  if (error) {
    console.error('fan-sign insert error', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ ok: true })
}
