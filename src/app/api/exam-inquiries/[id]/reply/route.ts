import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST: 선생님 답변 등록 { body }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = admin()
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = await db.auth.getUser(token ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await db.from('profiles').select('role, name').eq('id', user.id).single()
  if (!profile || profile.role !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: inquiryId } = await params
  const { body } = await req.json()
  if (!body?.trim()) return NextResponse.json({ error: 'Missing body' }, { status: 400 })

  const { data: reply, error } = await db
    .from('exam_inquiry_replies')
    .insert({ inquiry_id: inquiryId, teacher_id: user.id, body: body.trim() })
    .select('id, body, created_at, teacher_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reply: { ...reply, teacherName: profile.name ?? '선생님' } })
}
