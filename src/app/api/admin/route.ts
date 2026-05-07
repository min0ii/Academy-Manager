import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function isAdmin(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return false
  const { data: { user } } = await db.auth.getUser(token)
  if (!user) return false
  const { data } = await db.from('profiles').select('is_admin').eq('id', user.id).single()
  return data?.is_admin === true
}

// GET: 원장 계정 목록 (pending 우선)
export async function GET(req: NextRequest) {
  if (!await isAdmin(req)) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

  const { data } = await db
    .from('profiles')
    .select('id, name, phone, status, created_at')
    .eq('role', 'teacher')
    .order('created_at', { ascending: false })

  return NextResponse.json(data ?? [])
}

// PATCH: 승인/거절
export async function PATCH(req: NextRequest) {
  if (!await isAdmin(req)) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

  const { profileId, status } = await req.json()
  if (!profileId || !['approved', 'rejected'].includes(status))
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

  await db.from('profiles').update({ status }).eq('id', profileId)
  return NextResponse.json({ ok: true })
}
