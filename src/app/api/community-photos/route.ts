export async function GET() {
  const res = await fetch('https://ridewithgps.com/routes/54558564/community_photos.json', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 3600 },
  })
  const data = await res.json()
  return Response.json(data)
}
