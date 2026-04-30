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

// GET /api/exams/[examId]/questions
// 학생: 시험 문제 + 선택지 조회 (정답 제외)
// start_at 이전에는 접근 불가, end_at 이후에도 answer_reveal에 따라 정답 노출 결정
export async function GET(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const studentId = await verifyStudent(db, token)
  if (!studentId) return NextResponse.json({ error: '학생 계정만 접근할 수 있어요.' }, { status: 403 })

  const { examId } = await params

  const { data: exam } = await db.from('exams')
    .select('id, title, start_at, end_at, status, answer_reveal, class_id')
    .eq('id', examId).single()
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })

  const now = new Date()
  if (exam.start_at && new Date(exam.start_at) > now)
    return NextResponse.json({ error: '아직 시작 전인 시험이에요.' }, { status: 403 })

  const { data: questions } = await db.from('exam_questions')
    .select('id, order_num, question_text, question_type, score')
    .eq('exam_id', examId).order('order_num')

  const questionIds = (questions ?? []).map(q => q.id)

  const { data: choices } = questionIds.length
    ? await db.from('exam_choices').select('id, question_id, choice_num, choice_text')
        .in('question_id', questionIds).order('choice_num')
    : { data: [] }

  // 정답: 마감됐고 answer_reveal=immediate, 또는 answer_reveal=after_close이면 마감 후 공개
  let answers: { question_id: string; answer_text: string }[] = []
  const isClosed = exam.status === 'closed' || (exam.end_at && new Date(exam.end_at) < now)
  if (isClosed) {
    // 제출한 학생의 답안 기록 조회 (is_correct 포함)
    const { data: sub } = await db.from('exam_submissions')
      .select('id, is_submitted').eq('exam_id', examId).eq('student_id', studentId).maybeSingle()
    if (sub?.is_submitted && exam.answer_reveal === 'immediate') {
      const { data: correctAnswers } = await db.from('exam_correct_answers')
        .select('question_id, answer_text').in('question_id', questionIds)
      answers = correctAnswers ?? []
    }
  }

  return NextResponse.json({
    exam: {
      id: exam.id,
      title: exam.title,
      start_at: exam.start_at,
      end_at: exam.end_at,
      status: exam.status,
      answer_reveal: exam.answer_reveal,
    },
    questions: questions ?? [],
    choices: choices ?? [],
    answers,  // empty unless revealed
  })
}
