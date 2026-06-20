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

// GET /api/exams/[examId]
// 시험 상세 (문제 + 선택지 + 정답 포함)
export async function GET(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const auth = await verifyTeacher(db, token)
  if (!auth?.academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { examId } = await params

  const { data: exam } = await db.from('exams')
    .select('*').eq('id', examId).single()
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })

  // 다른 학원 시험 접근 차단
  const { data: ownCls } = await db.from('classes').select('id').eq('id', (exam as any).class_id).eq('academy_id', auth.academyId).maybeSingle()
  if (!ownCls) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

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
  const auth = await verifyTeacher(db, token)
  if (!auth?.academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { examId } = await params

  // 다른 학원 시험 삭제 차단
  if (!await examInAcademy(db, examId, auth.academyId))
    return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

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
  const auth = await verifyTeacher(db, token)
  if (!auth?.academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { examId } = await params
  const body = await req.json()
  const { action } = body

  // 다른 학원 시험 수정 차단 (모든 action 공통)
  if (!await examInAcademy(db, examId, auth.academyId))
    return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  // ── 시험 시작 ──
  if (action === 'start') {
    const { data: exam } = await db.from('exams').select('status').eq('id', examId).single()
    if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })
    if (exam.status !== 'scheduled') return NextResponse.json({ error: '이미 시작됐거나 마감된 시험이에요.' }, { status: 400 })
    await db.from('exams').update({ status: 'active', start_at: new Date().toISOString() }).eq('id', examId)
    return NextResponse.json({ success: true })
  }

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
      db.from('class_students').select('student_id, students!inner(status)').eq('class_id', exam.class_id).eq('students.status', 'active'),
      db.from('exam_questions').select('id, score, question_type').eq('exam_id', examId),
      db.from('exam_submissions').select('id, student_id, is_submitted').eq('exam_id', examId),
    ])

    const studentIds = (classStudents ?? []).map(cs => cs.student_id)
    // 그룹(소문제 부모) 문제는 채점 대상에서 제외
    const qs = (questions ?? []).filter(q => q.question_type !== 'group')
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
      // 단, 아무 답안도 없는 학생은 미제출(is_submitted=false)로 유지
      const answerUpserts: Record<string, unknown>[] = []
      const now = new Date().toISOString()
      const submissionScores: { id: string; score: number }[] = []

      for (const studentId of unsubmittedStudents) {
        const sub = submissionByStudent.get(studentId)!
        const answerMap = answersBySubmission.get(sub.id) ?? new Map()

        // 아무 답안도 없으면 미제출로 남김 (0점 처리 안 함)
        const hasAnyAnswer = Array.from(answerMap.values()).some(v => v && String(v).trim() !== '')
        if (!hasAnyAnswer) continue

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
        submissionScores.push({ id: sub.id, score: Math.round(totalScore * 100) / 100 })
      }

      // 7. 답안 일괄 upsert (500개씩 청크)
      const CHUNK = 500
      for (let i = 0; i < answerUpserts.length; i += CHUNK) {
        await db.from('exam_student_answers').upsert(
          answerUpserts.slice(i, i + CHUNK),
          { onConflict: 'submission_id,question_id' }
        )
      }

      // 8. 제출 상태 일괄 업데이트 (답안 있는 학생만, 병렬)
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

  // ── 정답 공개 ──
  if (action === 'reveal_answers') {
    const { data: exam } = await db.from('exams').select('status, answer_reveal').eq('id', examId).single()
    if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없어요.' }, { status: 404 })
    if (exam.status !== 'closed') return NextResponse.json({ error: '마감된 시험만 정답을 공개할 수 있어요.' }, { status: 400 })
    await db.from('exams').update({ answer_reveal: 'revealed' }).eq('id', examId)
    return NextResponse.json({ success: true })
  }

  // ── 제목만 수정 (active/closed 포함 모든 상태 가능) ──
  if (action === 'update_title') {
    const { title } = body
    if (!title?.trim()) return NextResponse.json({ error: '제목을 입력해주세요.' }, { status: 400 })
    await db.from('exams').update({ title: title.trim() }).eq('id', examId)
    return NextResponse.json({ success: true })
  }

  // ── 카테고리 수정 (모든 상태 가능) ──
  if (action === 'update_category') {
    const { category } = body
    await db.from('exams').update({ category: category?.trim() || null }).eq('id', examId)
    return NextResponse.json({ success: true })
  }

  // ── scheduled 시험 전체 수정 ──
  if (action === 'update_scheduled') {
    const { data: examCheck } = await db.from('exams').select('status').eq('id', examId).single()
    if (!examCheck || examCheck.status !== 'scheduled')
      return NextResponse.json({ error: '예정 상태의 시험만 수정할 수 있어요.' }, { status: 400 })
    const { title, endAt, answerReveal, questions: newQs, category } = body
    await db.from('exams').update({
      title: title?.trim() ?? undefined,
      end_at: endAt ?? null,
      answer_reveal: answerReveal ?? 'after_close',
      category: category?.trim() || null,
    }).eq('id', examId)
    if (Array.isArray(newQs)) {
      // 기존 questions id 수집 → choices/answers/questions 삭제
      const { data: oldQs } = await db.from('exam_questions').select('id').eq('exam_id', examId)
      const oldIds = (oldQs ?? []).map((q: { id: string }) => q.id)
      if (oldIds.length > 0) {
        await Promise.all([
          db.from('exam_correct_answers').delete().in('question_id', oldIds),
          db.from('exam_choices').delete().in('question_id', oldIds),
        ])
        await db.from('exam_questions').delete().in('id', oldIds)
      }
      // 새 questions 삽입 (그룹 소문제 지원)
      for (const q of newQs) {
        if (q.questionType === 'group') {
          const { data: parent } = await db.from('exam_questions').insert({
            exam_id: examId,
            order_num: q.orderNum,
            question_text: null,
            question_type: 'group',
            score: 0,
            question_label: q.label ?? null,
            group_context: q.groupContext ?? null,
          }).select('id').single()
          if (!parent) continue

          for (let ci = 0; ci < (q.children ?? []).length; ci++) {
            const child = q.children[ci]
            const childLabel = child.label ?? `${q.label ?? q.orderNum}-${ci + 1}`
            const { data: childQ } = await db.from('exam_questions').insert({
              exam_id: examId,
              order_num: ci + 1,
              question_text: child.questionText ?? null,
              question_type: child.questionType,
              score: child.score,
              question_label: childLabel,
              parent_question_id: parent.id,
            }).select('id').single()
            if (!childQ) continue

            if (child.questionType === 'multiple_choice' && child.choices?.length) {
              await db.from('exam_choices').insert(
                child.choices.map((c: { num: number; text: string }) => ({
                  question_id: childQ.id, choice_num: c.num, choice_text: c.text ?? null,
                }))
              )
            }
            if (child.answers?.length) {
              await db.from('exam_correct_answers').insert(
                child.answers.map((a: string, idx: number) => ({
                  question_id: childQ.id, answer_text: a, order_num: idx + 1,
                }))
              )
            }
          }
        } else {
          const { data: question } = await db.from('exam_questions').insert({
            exam_id: examId,
            order_num: q.orderNum,
            question_text: q.questionText ?? null,
            question_type: q.questionType,
            score: q.score,
            question_label: q.label ?? null,
          }).select('id').single()
          if (!question) continue
          if (q.questionType === 'multiple_choice' && q.choices?.length) {
            await db.from('exam_choices').insert(
              q.choices.map((c: { num: number; text: string }) => ({
                question_id: question.id, choice_num: c.num, choice_text: c.text ?? null,
              }))
            )
          }
          if (q.answers?.length) {
            await db.from('exam_correct_answers').insert(
              q.answers.map((a: string, idx: number) => ({
                question_id: question.id, answer_text: a, order_num: idx + 1,
              }))
            )
          }
        }
      }
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: '알 수 없는 action이에요.' }, { status: 400 })
}
