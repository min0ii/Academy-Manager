import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// DELETE /api/exam-inquiries/[id] — 학생 본인 질문 취소
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = admin()
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = await db.auth.getUser(token ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: inquiryId } = await params

  // 본인 학생 확인
  const { data: student } = await db.from('students').select('id').eq('user_id', user.id).maybeSingle()
  if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 본인 질문인지 확인
  const { data: inquiry } = await db.from('exam_inquiries')
    .select('id').eq('id', inquiryId).eq('student_id', student.id).maybeSingle()
  if (!inquiry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.from('exam_inquiries').delete().eq('id', inquiryId)

  return NextResponse.json({ success: true })
}
