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

function gradeAnswer(studentAns: string, correctList: string[]): boolean {
  const norm = studentAns.trim().toLowerCase()
  if (!norm) return false
  return correctList.some(c => c.trim().toLowerCase() === norm)
}

// POST /api/exams/[examId]/submit
// 학생: 최종 제출 + 자동 채점
export async function POST(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const studentId = await verifyStudent(db, token)
  if (!studentId) return NextResponse.json({ error: '학생 계정만 접근할 수 있어요.' }, { status: 403 })

  const { examId } = await params

  // 시험 확인
  const { data: exam } = await db.from('exams').select('end_at, status, exam_type').eq('id', examId).single()
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })
  if (exam.status === 'closed') return NextResponse.json({ error: '마감된 시험이에요.' }, { status: 403 })
  if (exam.end_at && new Date(exam.end_at) < new Date())
    return NextResponse.json({ error: '마감 시간이 지났어요.' }, { status: 403 })

  // 이미 제출 확인
  const { data: existingSub } = await db.from('exam_submissions')
    .select('id, is_submitted').eq('exam_id', examId).eq('student_id', studentId).maybeSingle()
  if (existingSub?.is_submitted) return NextResponse.json({ error: '이미 제출한 시험이에요.' }, { status: 403 })

  let submissionId = existingSub?.id
  if (!submissionId) {
    const { data: newSub } = await db.from('exam_submissions').insert({
      exam_id: examId, student_id: studentId, is_submitted: false,
    }).select('id').single()
    submissionId = newSub?.id
  }
  if (!submissionId) return NextResponse.json({ error: '제출 실패' }, { status: 500 })

  // 문제 + 정답 조회
  const { data: questions } = await db.from('exam_questions')
    .select('id, score, question_type').eq('exam_id', examId)
  const questionIds = (questions ?? []).map(q => q.id)

  const { data: correctAnswers } = await db.from('exam_correct_answers')
    .select('question_id, answer_text').in('question_id', questionIds)

  const correctMap = new Map<string, string[]>()
  for (const ca of correctAnswers ?? []) {
    if (!correctMap.has(ca.question_id)) correctMap.set(ca.question_id, [])
    correctMap.get(ca.question_id)!.push(ca.answer_text)
  }

  // 임시저장된 답안
  const { data: draftAnswers } = await db.from('exam_student_answers')
    .select('question_id, student_answer').eq('submission_id', submissionId)
  const answerMap = new Map((draftAnswers ?? []).map(a => [a.question_id, a.student_answer ?? '']))

  // 채점
  let totalScore = 0
  const gradedAnswers = (questions ?? []).map(q => {
    const studentAns = answerMap.get(q.id) ?? ''
    const correctList = correctMap.get(q.id) ?? []
    const isCorrect = gradeAnswer(studentAns, correctList)
    const scoreEarned = isCorrect ? Number(q.score) : 0
    totalScore += scoreEarned
    return {
      submission_id: submissionId!,
      question_id: q.id,
      student_answer: studentAns || null,
      is_correct: isCorrect,
      score_earned: scoreEarned,
      manually_overridden: false,
    }
  })

  // 답안 저장
  if (gradedAnswers.length > 0) {
    await db.from('exam_student_answers').upsert(gradedAnswers, { onConflict: 'submission_id,question_id' })
  }

  // 제출 완료
  await db.from('exam_submissions').update({
    is_submitted: true,
    submitted_at: new Date().toISOString(),
    auto_score: totalScore,
  }).eq('id', submissionId)

  // 결과 반환 (문제별 정오 + 득점)
  return NextResponse.json({
    success: true,
    totalScore,
    maxScore: (questions ?? []).reduce((acc, q) => acc + Number(q.score), 0),
    answers: gradedAnswers.map(a => ({
      questionId: a.question_id,
      studentAnswer: a.student_answer,
      isCorrect: a.is_correct,
      scoreEarned: a.score_earned,
    })),
  })
}
