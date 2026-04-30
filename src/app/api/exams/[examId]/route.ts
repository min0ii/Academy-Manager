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
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'teacher') return null
  return user.id
}

// GET /api/exams/[examId]
// 시험 상세 (문제 + 선택지 + 정답 포함)
export async function GET(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const teacherId = await verifyTeacher(db, token)
  if (!teacherId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { examId } = await params

  const { data: exam } = await db.from('exams')
    .select('*').eq('id', examId).single()
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })

  const { data: questions } = await db.from('exam_questions')
    .select('*').eq('exam_id', examId).order('order_num')

  const questionIds = (questions ?? []).map(q => q.id)

  const { data: choices } = questionIds.length
    ? await db.from('exam_choices').select('*').in('question_id', questionIds).order('choice_num')
    : { data: [] }

  const { data: answers } = questionIds.length
    ? await db.from('exam_correct_answers').select('*').in('question_id', questionIds).order('order_num')
    : { data: [] }

  return NextResponse.json({ exam, questions: questions ?? [], choices: choices ?? [], answers: answers ?? [] })
}

// DELETE /api/exams/[examId]
// 시험 삭제 (cascade로 문제/제출 전부 삭제)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const teacherId = await verifyTeacher(db, token)
  if (!teacherId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { examId } = await params

  const { error } = await db.from('exams').delete().eq('id', examId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

// PATCH /api/exams/[examId]
// action=close : 시험 조기 마감 + 미제출 학생 일괄 처리
// action=update_answer : 정답 수정 후 전체 재채점
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const teacherId = await verifyTeacher(db, token)
  if (!teacherId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { examId } = await params
  const body = await req.json()
  const { action } = body

  // ── 조기 마감 (배치 최적화) ──
  if (action === 'close') {
    const { data: exam } = await db.from('exams').select('class_id, status').eq('id', examId).single()
    if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })
    if (exam.status === 'closed') return NextResponse.json({ error: '이미 마감된 시험이에요.' }, { status: 400 })

    // 1. 병렬 조회: 반 학생 + 문제 + 기존 제출 현황
    const [
      { data: classStudents },
      { data: questions },
      { data: existingSubmissions },
    ] = await Promise.all([
      db.from('class_students').select('student_id').eq('class_id', exam.class_id),
      db.from('exam_questions').select('id, score, question_type').eq('exam_id', examId),
      db.from('exam_submissions').select('id, student_id, is_submitted').eq('exam_id', examId),
    ])

    const studentIds = (classStudents ?? []).map(cs => cs.student_id)
    const qs = questions ?? []
    const questionIds = qs.map(q => q.id)

    // 제출 현황 맵 (student_id → submission)
    const submissionByStudent = new Map<string, { id: string; isSubmitted: boolean }>()
    for (const s of (existingSubmissions ?? [])) {
      submissionByStudent.set(s.student_id, { id: s.id, isSubmitted: s.is_submitted })
    }

    // 2. 정답 한 번만 조회 (모든 학생에 공통)
    const { data: correctAnswersData } = questionIds.length
      ? await db.from('exam_correct_answers').select('question_id, answer_text').in('question_id', questionIds)
      : { data: [] }

    const correctMap = new Map<string, string[]>()
    for (const ca of (correctAnswersData ?? [])) {
      if (!correctMap.has(ca.question_id)) correctMap.set(ca.question_id, [])
      correctMap.get(ca.question_id)!.push(ca.answer_text.trim().toLowerCase())
    }

    // 3. 제출 레코드 없는 학생들 한꺼번에 생성
    const studentsWithoutSub = studentIds.filter(id => !submissionByStudent.has(id))
    if (studentsWithoutSub.length > 0) {
      const newRows = studentsWithoutSub.map(studentId => ({
        exam_id: examId, student_id: studentId, is_submitted: false,
      }))
      const { data: newSubs } = await db.from('exam_submissions').insert(newRows).select('id, student_id')
      for (const ns of (newSubs ?? [])) {
        submissionByStudent.set(ns.student_id, { id: ns.id, isSubmitted: false })
      }
    }

    // 4. 미제출 학생들만 처리
    const unsubmittedStudents = studentIds.filter(id => {
      const sub = submissionByStudent.get(id)
      return sub && !sub.isSubmitted
    })

    if (unsubmittedStudents.length > 0) {
      const unsubmittedSubIds = unsubmittedStudents
        .map(id => submissionByStudent.get(id)!.id)

      // 5. 미제출 학생 임시답안 한 번에 조회
      const { data: allDraftAnswers } = await db.from('exam_student_answers')
        .select('submission_id, question_id, student_answer')
        .in('submission_id', unsubmittedSubIds)

      const answersBySubmission = new Map<string, Map<string, string>>()
      for (const ans of (allDraftAnswers ?? [])) {
        if (!answersBySubmission.has(ans.submission_id))
          answersBySubmission.set(ans.submission_id, new Map())
        answersBySubmission.get(ans.submission_id)!.set(ans.question_id, ans.student_answer)
      }

      // 6. 메모리에서 채점 — DB 호출 없음
      const answerUpserts: Record<string, unknown>[] = []
      const now = new Date().toISOString()
      const submissionScores: { id: string; score: number }[] = []

      for (const studentId of unsubmittedStudents) {
        const sub = submissionByStudent.get(studentId)!
        const answerMap = answersBySubmission.get(sub.id) ?? new Map()
        let totalScore = 0

        for (const q of qs) {
          const studentAns = (answerMap.get(q.id) ?? '').trim().toLowerCase()
          const correctAns = correctMap.get(q.id) ?? []
          const isCorrect = studentAns !== '' && correctAns.includes(studentAns)
          const scoreEarned = isCorrect ? Number(q.score) : 0
          totalScore += scoreEarned

          answerUpserts.push({
            submission_id: sub.id,
            question_id: q.id,
            student_answer: answerMap.get(q.id) ?? null,
            is_correct: isCorrect,
            score_earned: scoreEarned,
            manually_overridden: false,
          })
        }
        submissionScores.push({ id: sub.id, score: totalScore })
      }

      // 7. 답안 일괄 upsert (500개씩 청크)
      const CHUNK = 500
      for (let i = 0; i < answerUpserts.length; i += CHUNK) {
        await db.from('exam_student_answers').upsert(
          answerUpserts.slice(i, i + CHUNK),
          { onConflict: 'submission_id,question_id' }
        )
      }

      // 8. 제출 상태 일괄 업데이트 (병렬)
      await Promise.all(submissionScores.map(({ id, score }) =>
        db.from('exam_submissions').update({
          is_submitted: true,
          submitted_at: now,
          auto_score: score,
        }).eq('id', id)
      ))
    }

    // 9. 시험 상태 closed로 변경
    await db.from('exams').update({ status: 'closed' }).eq('id', examId)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: '알 수 없는 action이에요.' }, { status: 400 })
}
