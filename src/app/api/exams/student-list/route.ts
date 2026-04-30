import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function verifyStudent(db: ReturnType<typeof admin>, token: string) {
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return null
  const { data: student } = await db.from('students').select('id').eq('user_id', user.id).maybeSingle()
  return student?.id ? { studentId: student.id } : null
}

// GET /api/exams/student-list?classId=xxx
// 학생: 자신의 반에서 현재 응시 가능한 시험 목록 (정답 제외)
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const info = await verifyStudent(db, token)
  if (!info) return NextResponse.json({ error: '학생 계정만 접근할 수 있어요.' }, { status: 403 })

  const classId = req.nextUrl.searchParams.get('classId')
  if (!classId) return NextResponse.json({ error: 'classId가 필요해요.' }, { status: 400 })

  const now = new Date().toISOString()

  // 자동채점 시험 중 시작됐고 아직 안 마감된 것 (status가 closed가 아니고, start_at <= now, end_at >= now)
  const { data: exams } = await db.from('exams')
    .select('id, title, exam_type, start_at, end_at, status, answer_reveal')
    .eq('class_id', classId)
    .eq('exam_type', 'auto')
    .neq('status', 'closed')
    .lte('start_at', now)
    .gte('end_at', now)
    .order('start_at')

  if (!exams?.length) return NextResponse.json({ exams: [] })

  // 이미 제출한 시험 ID 조회
  const examIds = exams.map(e => e.id)
  const { data: submissions } = await db.from('exam_submissions')
    .select('exam_id, is_submitted')
    .eq('student_id', info.studentId)
    .in('exam_id', examIds)
    .eq('is_submitted', true)

  const submittedSet = new Set((submissions ?? []).map(s => s.exam_id))

  const result = exams.map(e => ({
    id: e.id,
    title: e.title,
    start_at: e.start_at,
    end_at: e.end_at,
    answer_reveal: e.answer_reveal,
    isSubmitted: submittedSet.has(e.id),
  }))

  return NextResponse.json({ exams: result })
}
