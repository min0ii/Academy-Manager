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
  return student?.id ?? null
}

// GET /api/exams/[examId]/draft
// 학생: 임시저장된 답안 불러오기
export async function GET(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const studentId = await verifyStudent(db, token)
  if (!studentId) return NextResponse.json({ error: '학생 계정만 접근할 수 있어요.' }, { status: 403 })

  const { examId } = await params

  // 시험 상태 확인
  const { data: exam } = await db.from('exams').select('start_at, end_at, status').eq('id', examId).single()
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })

  const now = new Date()
  if (exam.start_at && new Date(exam.start_at) > now)
    return NextResponse.json({ error: '아직 시작 전인 시험이에요.' }, { status: 403 })

  // 제출 여부 확인
  const { data: submission } = await db.from('exam_submissions')
    .select('id, is_submitted').eq('exam_id', examId).eq('student_id', studentId).maybeSingle()

  if (submission?.is_submitted) {
    return NextResponse.json({ alreadySubmitted: true })
  }

  // 임시저장된 답안
  const answers: Record<string, string> = {}
  if (submission) {
    const { data: draftAnswers } = await db.from('exam_student_answers')
      .select('question_id, student_answer').eq('submission_id', submission.id)
    for (const a of draftAnswers ?? []) {
      if (a.student_answer !== null) answers[a.question_id] = a.student_answer
    }
  }

  return NextResponse.json({ answers, submissionId: submission?.id ?? null })
}

// POST /api/exams/[examId]/draft
// 학생: 답안 임시저장 (단일 문항)
export async function POST(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const studentId = await verifyStudent(db, token)
  if (!studentId) return NextResponse.json({ error: '학생 계정만 접근할 수 있어요.' }, { status: 403 })

  const { examId } = await params
  const { questionId, answer } = await req.json()

  // 마감 확인
  const { data: exam } = await db.from('exams').select('end_at, status').eq('id', examId).single()
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })
  if (exam.status === 'closed') return NextResponse.json({ error: '마감된 시험이에요.' }, { status: 403 })
  if (exam.end_at && new Date(exam.end_at) < new Date())
    return NextResponse.json({ error: '마감 시간이 지났어요.' }, { status: 403 })

  // 이미 제출 확인
  const { data: existing } = await db.from('exam_submissions')
    .select('id, is_submitted').eq('exam_id', examId).eq('student_id', studentId).maybeSingle()
  if (existing?.is_submitted) return NextResponse.json({ error: '이미 제출된 시험이에요.' }, { status: 403 })

  // 제출 레코드 없으면 생성
  let submissionId = existing?.id
  if (!submissionId) {
    const { data: newSub } = await db.from('exam_submissions').insert({
      exam_id: examId, student_id: studentId, is_submitted: false,
    }).select('id').single()
    submissionId = newSub?.id
  }
  if (!submissionId) return NextResponse.json({ error: '저장 실패' }, { status: 500 })

  // 답안 upsert
  await db.from('exam_student_answers').upsert({
    submission_id: submissionId,
    question_id: questionId,
    student_answer: answer ?? null,
    is_correct: null,
    score_earned: 0,
    manually_overridden: false,
  }, { onConflict: 'submission_id,question_id' })

  return NextResponse.json({ success: true, submissionId })
}
