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

  // scheduled 또는 active 상태인 자동채점 시험 모두 반환 (시간 필터 없음)
  const { data: exams } = await db.from('exams')
    .select('id, title, exam_type, start_at, end_at, status, answer_reveal, no_deadline')
    .eq('class_id', classId)
    .eq('exam_type', 'auto')
    .in('status', ['scheduled', 'active'])
    .order('created_at')

  if (!exams?.length) return NextResponse.json({ exams: [] })

  // 제출/포기 여부 조회
  const examIds = exams.map(e => e.id)
  const { data: submissions } = await db.from('exam_submissions')
    .select('exam_id, is_submitted, is_forfeited')
    .eq('student_id', info.studentId)
    .in('exam_id', examIds)

  const submittedSet = new Set((submissions ?? []).filter(s => s.is_submitted && !s.is_forfeited).map(s => s.exam_id))
  const forfeitedSet = new Set((submissions ?? []).filter(s => s.is_forfeited).map(s => s.exam_id))

  const result = exams
    .filter(e => {
      // 마감없는 시험에서 이미 제출하거나 포기한 경우 목록에서 제외 (성적 탭에서 확인)
      if (e.no_deadline && submittedSet.has(e.id)) return false
      // 포기한 시험은 모든 시험 유형에서 제외
      if (forfeitedSet.has(e.id)) return false
      return true
    })
    .map(e => ({
      id: e.id,
      title: e.title,
      status: e.status,
      start_at: e.start_at,
      end_at: e.end_at,
      answer_reveal: e.answer_reveal,
      no_deadline: e.no_deadline ?? false,
      isSubmitted: submittedSet.has(e.id),
    }))

  return NextResponse.json({ exams: result })
}
