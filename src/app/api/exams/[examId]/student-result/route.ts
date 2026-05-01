import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET /api/exams/[examId]/student-result?studentId=xxx
// 학생이 본인 시험 결과를 조회 (정답 공개 여부에 따라 correct answers 포함/제외)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()

  // 학생 본인 확인
  const { data: { user }, error: authError } = await db.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const studentId = req.nextUrl.searchParams.get('studentId')
  if (!studentId) return NextResponse.json({ error: 'studentId가 필요해요.' }, { status: 400 })

  // 본인이거나 연결된 학부모인지 확인
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  if (profile.role === 'student') {
    const { data: student } = await db.from('students').select('id').eq('user_id', user.id).single()
    if (!student || student.id !== studentId)
      return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })
  } else if (profile.role === 'parent') {
    const { data: rel } = await db.from('parent_students').select('student_id').eq('parent_id', user.id).eq('student_id', studentId).single()
    if (!rel) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })
  } else {
    return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })
  }

  const { examId } = await params

  // 시험 정보
  const { data: exam } = await db.from('exams')
    .select('id, title, status, answer_reveal, exam_type, start_at, created_at, max_score')
    .eq('id', examId).single()
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })

  // 마감된 시험만 결과 조회 가능
  if (exam.status !== 'closed')
    return NextResponse.json({ error: '마감 후 결과를 확인할 수 있어요.' }, { status: 400 })

  // 수동 시험
  if (exam.exam_type === 'manual') {
    const { data: submission } = await db.from('exam_submissions')
      .select('id, is_submitted, adjusted_score, auto_score')
      .eq('exam_id', examId).eq('student_id', studentId).single()

    const myScore = submission?.is_submitted
      ? (submission.adjusted_score ?? submission.auto_score)
      : null
    const isAbsent = submission?.is_submitted && submission.adjusted_score === null && submission.auto_score === null

    return NextResponse.json({
      examType: 'manual',
      title: exam.title,
      maxScore: exam.max_score,
      myScore: isAbsent ? null : myScore,
      isAbsent: isAbsent ?? false,
      answerReveal: exam.answer_reveal,
      questions: [],
      myAnswers: [],
      correctAnswers: [],
    })
  }

  // 자동 채점 시험
  const { data: questions } = await db.from('exam_questions')
    .select('id, order_num, question_text, question_type, score')
    .eq('exam_id', examId).order('order_num')

  const questionIds = (questions ?? []).map(q => q.id)

  // 내 제출
  const { data: submission } = await db.from('exam_submissions')
    .select('id, is_submitted, auto_score, adjusted_score')
    .eq('exam_id', examId).eq('student_id', studentId).single()

  // 내 답안
  const { data: myAnswers } = submission?.id
    ? await db.from('exam_student_answers')
        .select('question_id, student_answer, is_correct, score_earned')
        .eq('submission_id', submission.id)
    : { data: [] }

  // 선택지
  const { data: choices } = questionIds.length
    ? await db.from('exam_choices').select('question_id, choice_num, choice_text').in('question_id', questionIds).order('choice_num')
    : { data: [] }

  // 정답 공개 여부 판단
  const canReveal = exam.answer_reveal === 'after_close' || exam.answer_reveal === 'revealed'

  // 정답 (공개 허용 시에만)
  const { data: correctAnswers } = (canReveal && questionIds.length)
    ? await db.from('exam_correct_answers')
        .select('question_id, answer_text, order_num')
        .in('question_id', questionIds).order('order_num')
    : { data: [] }

  // 만점 계산
  const maxScore = (questions ?? []).reduce((s, q) => s + Number(q.score), 0)
  const myScore = submission?.is_submitted
    ? (submission.adjusted_score ?? submission.auto_score)
    : null

  return NextResponse.json({
    examType: 'auto',
    title: exam.title,
    maxScore,
    myScore,
    isAbsent: false,
    answerReveal: exam.answer_reveal,
    canReveal,
    questions: questions ?? [],
    choices: choices ?? [],
    myAnswers: myAnswers ?? [],
    correctAnswers: correctAnswers ?? [],
  })
}
