import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function verifyTeacher(db: ReturnType<typeof admin>, token: string) {
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return null
  const { data: p } = await db.from('profiles').select('role').eq('id', user.id).single()
  return p?.role === 'teacher' ? user.id : null
}

// GET /api/exams/[examId]/submissions
// 선생님: 해당 시험의 모든 학생 제출 현황 조회
export async function GET(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const teacherId = await verifyTeacher(db, token)
  if (!teacherId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { examId } = await params

  // 시험 정보
  const { data: exam } = await db.from('exams').select('class_id, exam_type, status').eq('id', examId).single()
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })

  // 반 학생 전체
  const { data: classStudents } = await db
    .from('class_students')
    .select('students(id, name)')
    .eq('class_id', exam.class_id)

  const students = (classStudents ?? []).map((cs: any) => cs.students).filter(Boolean)

  // 제출 현황
  const { data: submissions } = await db
    .from('exam_submissions')
    .select('id, student_id, is_submitted, submitted_at, auto_score, adjusted_score')
    .eq('exam_id', examId)

  const subMap = new Map((submissions ?? []).map(s => [s.student_id, s]))

  // 문제별 답안 (자동 채점 시험)
  let questionAnswers: any[] = []
  if (exam.exam_type === 'auto') {
    const submittedIds = (submissions ?? []).filter(s => s.is_submitted).map(s => s.id)
    if (submittedIds.length > 0) {
      const { data: answers } = await db
        .from('exam_student_answers')
        .select('submission_id, question_id, student_answer, is_correct, score_earned, manually_overridden')
        .in('submission_id', submittedIds)
      questionAnswers = answers ?? []
    }
  }

  const answersBySubmission = new Map<string, any[]>()
  for (const a of questionAnswers) {
    if (!answersBySubmission.has(a.submission_id)) answersBySubmission.set(a.submission_id, [])
    answersBySubmission.get(a.submission_id)!.push(a)
  }

  const result = students.map(student => {
    const sub = subMap.get(student.id)
    const finalScore = sub?.adjusted_score ?? sub?.auto_score ?? null
    return {
      studentId: student.id,
      studentName: student.name,
      submissionId: sub?.id ?? null,
      isSubmitted: sub?.is_submitted ?? false,
      submittedAt: sub?.submitted_at ?? null,
      autoScore: sub?.auto_score ?? null,
      adjustedScore: sub?.adjusted_score ?? null,
      finalScore,
      answers: sub ? (answersBySubmission.get(sub.id) ?? []) : [],
    }
  })

  return NextResponse.json({ students: result })
}

// POST /api/exams/[examId]/submissions
// 선생님: 수동 시험 점수 저장 / 자동 시험 점수 조정
export async function POST(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const teacherId = await verifyTeacher(db, token)
  if (!teacherId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { examId } = await params
  const body = await req.json()
  // scores: [{ studentId, score }]  OR  adjustments: [{ submissionId, adjustedScore }]
  const { scores, adjustments } = body

  // 수동 시험: 학생별 점수 저장
  if (scores) {
    for (const { studentId, score } of scores) {
      await db.from('exam_submissions').upsert({
        exam_id: examId,
        student_id: studentId,
        is_submitted: score !== null,
        submitted_at: score !== null ? new Date().toISOString() : null,
        auto_score: null,
        adjusted_score: score,
      }, { onConflict: 'exam_id,student_id' })
    }
    return NextResponse.json({ success: true })
  }

  // 자동 시험: 점수 수동 조정
  if (adjustments) {
    for (const { submissionId, adjustedScore } of adjustments) {
      await db.from('exam_submissions')
        .update({ adjusted_score: adjustedScore })
        .eq('id', submissionId)
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 400 })
}
