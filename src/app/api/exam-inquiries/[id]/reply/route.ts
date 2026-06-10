import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST: 답변 등록 { body } — 원장/선생님/조교 모두 허용 (학원 소속 여부로만 확인)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = admin()
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = await db.auth.getUser(token ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: inquiryId } = await params
  const { body } = await req.json()
  if (!body?.trim()) return NextResponse.json({ error: 'Missing body' }, { status: 400 })

  // 이 질문이 속한 학원 확인
  const { data: inquiry } = await db
    .from('exam_inquiries')
    .select('exam_id, exams (class_id, classes (academy_id))')
    .eq('id', inquiryId)
    .single()
  if (!inquiry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const academyId = (inquiry.exams as unknown as { classes: { academy_id: string } })?.classes?.academy_id
  if (!academyId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 원장 또는 팀 소속 확인 (role 무관)
  const { data: ownAcademy } = await db.from('academies').select('id').eq('id', academyId).eq('teacher_id', user.id).maybeSingle()
  const { data: teamMember } = await db.from('academy_teachers').select('academy_id').eq('academy_id', academyId).eq('teacher_id', user.id).maybeSingle()
  if (!ownAcademy && !teamMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: profile } = await db.from('profiles').select('name').eq('id', user.id).single()

  const { data: reply, error } = await db
    .from('exam_inquiry_replies')
    .insert({ inquiry_id: inquiryId, teacher_id: user.id, body: body.trim() })
    .select('id, body, created_at, teacher_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reply: { ...reply, teacherName: profile?.name ?? '선생님' } })
}
