import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { applyLivesRulesInternal } from '@/lib/lives-auto'

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
  if (p?.role !== 'teacher') return null
  const { data: m } = await db.from('academy_teachers').select('academy_id').eq('teacher_id', user.id).single()
  return { teacherId: user.id, academyId: m?.academy_id ?? null }
}

// 시험이 이 선생님의 학원 소속인지 검증
async function examInAcademy(db: ReturnType<typeof admin>, examId: string, academyId: string) {
  const { data: exam } = await db.from('exams').select('class_id').eq('id', examId).single()
  if (!exam) return false
  const { data: cls } = await db.from('classes').select('id').eq('id', (exam as any).class_id).eq('academy_id', academyId).maybeSingle()
  return !!cls
}

// GET /api/exams/[examId]/submissions
// 선생님: 해당 시험의 모든 학생 제출 현황 조회
export async function GET(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const auth = await verifyTeacher(db, token)
  if (!auth?.academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { examId } = await params

  // 시험 정보
  const { data: exam } = await db.from('exams').select('class_id, exam_type, exam_format, status, max_score').eq('id', examId).single()
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })

  // 다른 학원 시험 접근 차단
  const { data: ownCls } = await db.from('classes').select('id').eq('id', (exam as any).class_id).eq('academy_id', auth.academyId).maybeSingle()
  if (!ownCls) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  // 반 학생 전체 (재원 학생만)
  const { data: classStudents } = await db
    .from('class_students')
    .select('students!inner(id, name)')
    .eq('class_id', exam.class_id)
    .eq('students.status', 'active')

  const students = (classStudents ?? []).map((cs: any) => cs.students).filter(Boolean)

  // 제출 현황
  const { data: submissions } = await db
    .from('exam_submissions')
    .select('id, student_id, is_submitted, is_forfeited, submitted_at, auto_score, adjusted_score, note')
    .eq('exam_id', examId)

  const subMap = new Map((submissions ?? []).map(s => [s.student_id, s as typeof s & { is_forfeited: boolean }]))

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
    const finalScore = sub ? (sub.adjusted_score ?? sub.auto_score ?? null) : null
    // 수동 시험 3-상태 판별: is_submitted=true + adjusted_score=null → 미실시
    const isAbsent = exam.exam_type === 'manual'
      ? (sub?.is_submitted === true && sub?.adjusted_score === null && sub?.auto_score === null)
      : false
    return {
      studentId: student.id,
      studentName: student.name,
      submissionId: sub?.id ?? null,
      isSubmitted: sub?.is_submitted ?? false,
      isForfeited: sub?.is_forfeited ?? false,
      isAbsent,
      submittedAt: sub?.submitted_at ?? null,
      autoScore: sub?.auto_score ?? null,
      adjustedScore: sub?.adjusted_score ?? null,
      finalScore,
      note: (sub as any)?.note ?? null,
      answers: sub ? (answersBySubmission.get(sub.id) ?? []) : [],
    }
  })

  return NextResponse.json({ maxScore: (exam as any).max_score ?? null, examFormat: (exam as any).exam_format ?? 'score', students: result })
}

// POST /api/exams/[examId]/submissions
// 선생님: 수동 시험 점수 저장 / 자동 시험 점수 조정
export async function POST(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const auth = await verifyTeacher(db, token)
  if (!auth?.academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { examId } = await params

  // 다른 학원 시험 점수 수정 차단
  if (!await examInAcademy(db, examId, auth.academyId))
    return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const body = await req.json()
  // scores: [{ studentId, status: 'submitted'|'not_submitted'|'absent', score: number|null }]
  // adjustments: [{ submissionId, adjustedScore }]
  // maxScore: number|null (수동 시험 만점 업데이트)
  const { scores, adjustments, maxScore } = body

  // 수동 시험: 학생별 점수 + 상태 저장
  if (scores) {
    // 현재 제출 상태 (신규 제출 감지용)
    const { data: currentSubs } = await db.from('exam_submissions')
      .select('student_id, is_submitted').eq('exam_id', examId)
    const currentSubMap = new Map((currentSubs ?? []).map(s => [s.student_id, s.is_submitted]))

    // 만점 업데이트
    if (maxScore !== undefined) {
      await db.from('exams').update({ max_score: maxScore !== null ? Number(maxScore) : null }).eq('id', examId)
    }

    const now = new Date().toISOString()
    await Promise.all((scores as { studentId: string; status: string; score: number | null }[]).map(async ({ studentId, status, score }) => {
      if (status === 'not_submitted') {
        // 미제출: 기존 레코드 있으면 is_submitted=false로 초기화
        await db.from('exam_submissions')
          .upsert({
            exam_id: examId,
            student_id: studentId,
            is_submitted: false,
            auto_score: null,
            adjusted_score: null,
          }, { onConflict: 'exam_id,student_id' })
      } else if (status === 'absent') {
        // 미실시: is_submitted=true, adjusted_score=null (구별 용도)
        await db.from('exam_submissions')
          .upsert({
            exam_id: examId,
            student_id: studentId,
            is_submitted: true,
            submitted_at: null,
            auto_score: null,
            adjusted_score: null,
          }, { onConflict: 'exam_id,student_id' })
      } else {
        // 제출: 점수 저장
        await db.from('exam_submissions')
          .upsert({
            exam_id: examId,
            student_id: studentId,
            is_submitted: true,
            submitted_at: now,
            auto_score: null,
            adjusted_score: score !== null && score !== undefined ? Number(score) : null,
          }, { onConflict: 'exam_id,student_id' })
      }
    }))

    // 목숨 자동화 트리거: 점수가 변경된 모든 학생 재계산
    const examForLives = await db.from('exams')
      .select('class_id, start_at, created_at')
      .eq('id', examId).single()
    if (examForLives.data) {
      const { data: classData } = await db.from('classes')
        .select('academy_id').eq('id', (examForLives.data as any).class_id).single()
      if (classData) {
        const academyId = (classData as any).academy_id
        for (const { studentId } of scores as { studentId: string; status: string; score: number | null }[]) {
          void applyLivesRulesInternal(db, academyId, studentId, 'exam_score', {})
        }
      }
    }

    return NextResponse.json({ success: true })
  }

  // 자동 시험: 점수 수동 조정
  if (adjustments) {
    const submissionIds = (adjustments as { submissionId: string; adjustedScore: number | null }[]).map(a => a.submissionId)

    await Promise.all((adjustments as { submissionId: string; adjustedScore: number | null }[]).map(({ submissionId, adjustedScore }) =>
      db.from('exam_submissions').update({ adjusted_score: adjustedScore }).eq('id', submissionId)
    ))

    // 목숨 재계산: 조정된 학생들
    const { data: affectedSubs } = await db.from('exam_submissions')
      .select('student_id, exam_id').in('id', submissionIds)
    if (affectedSubs?.length) {
      const { data: examInfo } = await db.from('exams').select('class_id').eq('id', examId).single()
      if (examInfo) {
        const { data: classData } = await db.from('classes').select('academy_id').eq('id', (examInfo as any).class_id).single()
        if (classData) {
          const academyId = (classData as any).academy_id
          const uniqueStudents = [...new Set(affectedSubs.map(s => s.student_id))]
          for (const studentId of uniqueStudents) {
            void applyLivesRulesInternal(db, academyId, studentId, 'exam_score', {})
          }
        }
      }
    }

    return NextResponse.json({ success: true })
  }

  // 자동 시험: 문항별 정답처리
  if (body.overrideAnswer) {
    const { submissionId, questionId } = body.overrideAnswer as { submissionId: string; questionId: string }

    // 해당 문항 배점 조회
    const { data: question } = await db.from('exam_questions').select('score').eq('id', questionId).single()
    if (!question) return NextResponse.json({ error: '문항을 찾을 수 없어요.' }, { status: 404 })

    // 정답처리: is_correct=true, score_earned=배점, manually_overridden=true
    await db.from('exam_student_answers')
      .update({ is_correct: true, score_earned: question.score, manually_overridden: true })
      .eq('submission_id', submissionId)
      .eq('question_id', questionId)

    // auto_score 재계산 (adjusted_score는 건드리지 않음)
    const { data: allAnswers } = await db.from('exam_student_answers')
      .select('score_earned').eq('submission_id', submissionId)
    const newAutoScore = Math.round((allAnswers ?? []).reduce((sum, a) => sum + (a.score_earned ?? 0), 0) * 100) / 100
    await db.from('exam_submissions').update({ auto_score: newAutoScore }).eq('id', submissionId)

    // 목숨 재계산
    const { data: sub } = await db.from('exam_submissions').select('student_id').eq('id', submissionId).single()
    if (sub) {
      const { data: examInfo } = await db.from('exams').select('class_id').eq('id', examId).single()
      if (examInfo) {
        const { data: classData } = await db.from('classes').select('academy_id').eq('id', (examInfo as any).class_id).single()
        if (classData) void applyLivesRulesInternal(db, (classData as any).academy_id, (sub as any).student_id, 'exam_score', {})
      }
    }

    return NextResponse.json({ success: true })
  }

  // 자동 시험: 정답처리 되돌리기
  if (body.undoOverride) {
    const { submissionId, questionId } = body.undoOverride as { submissionId: string; questionId: string }

    // 학생 답안 조회
    const { data: studentAns } = await db.from('exam_student_answers')
      .select('student_answer').eq('submission_id', submissionId).eq('question_id', questionId).single()

    // 정답 목록 조회
    const { data: correctAnswers } = await db.from('exam_correct_answers')
      .select('answer_text').eq('question_id', questionId)

    // 문항 배점 + 유형 조회
    const { data: question } = await db.from('exam_questions').select('score, question_type').eq('id', questionId).single()
    if (!question) return NextResponse.json({ error: '문항을 찾을 수 없어요.' }, { status: 404 })

    const given = studentAns?.student_answer ?? ''
    let isCorrect = false
    if ((correctAnswers ?? []).length > 0 && given.trim()) {
      if (question.question_type === 'multiple_choice') {
        const studentSet = new Set(given.split(',').map((s: string) => s.trim()).filter(Boolean))
        const correctSet = new Set((correctAnswers ?? []).map(a => a.answer_text.trim()))
        isCorrect = studentSet.size === correctSet.size && [...studentSet].every(s => correctSet.has(s))
      } else {
        const norm = given.trim().toLowerCase()
        isCorrect = (correctAnswers ?? []).some(a => a.answer_text.trim().toLowerCase() === norm)
      }
    }
    const scoreEarned = isCorrect ? question.score : 0

    // 원래 채점으로 복원
    await db.from('exam_student_answers')
      .update({ is_correct: isCorrect, score_earned: scoreEarned, manually_overridden: false })
      .eq('submission_id', submissionId)
      .eq('question_id', questionId)

    // auto_score 재계산
    const { data: allAnswers } = await db.from('exam_student_answers')
      .select('score_earned').eq('submission_id', submissionId)
    const newAutoScore = Math.round((allAnswers ?? []).reduce((sum, a) => sum + (a.score_earned ?? 0), 0) * 100) / 100
    await db.from('exam_submissions').update({ auto_score: newAutoScore }).eq('id', submissionId)

    // 목숨 재계산
    const { data: sub } = await db.from('exam_submissions').select('student_id').eq('id', submissionId).single()
    if (sub) {
      const { data: examInfo } = await db.from('exams').select('class_id').eq('id', examId).single()
      if (examInfo) {
        const { data: classData } = await db.from('classes').select('academy_id').eq('id', (examInfo as any).class_id).single()
        if (classData) void applyLivesRulesInternal(db, (classData as any).academy_id, (sub as any).student_id, 'exam_score', {})
      }
    }

    return NextResponse.json({ success: true })
  }

  // 코멘트 저장
  if (body.saveNote !== undefined) {
    const { studentId, note } = body.saveNote as { studentId: string; note: string | null }
    if (!studentId) return NextResponse.json({ error: 'studentId 필요' }, { status: 400 })
    await db.from('exam_submissions').upsert(
      { exam_id: examId, student_id: studentId, note: note || null },
      { onConflict: 'exam_id,student_id' }
    )
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 400 })
}
