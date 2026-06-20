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
  if (error || !user) return { user: null, academyId: null }
  const { data: m } = await db.from('academy_teachers').select('academy_id').eq('teacher_id', user.id).single()
  return { user, academyId: m?.academy_id ?? null }
}

// GET /api/question-bank/[setId]
// → 세트 정보 + 모든 문항 + 보기 + 정답
export async function GET(req: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const { academyId } = await verifyTeacher(db, token)
  if (!academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { setId } = await params

  // 세트 확인 (academy 소속 검증)
  const { data: set, error: setErr } = await db
    .from('qb_sets')
    .select('id, title, folder_id, created_at, updated_at')
    .eq('id', setId)
    .eq('academy_id', academyId)
    .single()
  if (setErr || !set) return NextResponse.json({ error: '세트를 찾을 수 없어요.' }, { status: 404 })

  // 문항 목록 (parent_id, group_context 포함)
  const { data: questions } = await db
    .from('qb_questions')
    .select('id, set_id, order_num, custom_label, question_text, question_type, score, parent_id, group_context')
    .eq('set_id', setId)
    .order('order_num')

  const qIds = (questions ?? []).map((q: any) => q.id)

  // 보기 + 정답 병렬 로드
  const [{ data: choices }, { data: answers }] = await Promise.all([
    qIds.length
      ? db.from('qb_choices').select('id, question_id, choice_num, choice_text').in('question_id', qIds).order('choice_num')
      : Promise.resolve({ data: [] }),
    qIds.length
      ? db.from('qb_answers').select('id, question_id, answer_text, order_num').in('question_id', qIds).order('order_num')
      : Promise.resolve({ data: [] }),
  ])

  // 문항별로 보기·정답 묶기
  const choiceMap: Record<string, any[]> = {}
  for (const c of (choices ?? [])) {
    if (!choiceMap[(c as any).question_id]) choiceMap[(c as any).question_id] = []
    choiceMap[(c as any).question_id].push(c)
  }
  const answerMap: Record<string, any[]> = {}
  for (const a of (answers ?? [])) {
    if (!answerMap[(a as any).question_id]) answerMap[(a as any).question_id] = []
    answerMap[(a as any).question_id].push(a)
  }

  const questionsWithData = (questions ?? []).map((q: any) => ({
    ...q,
    choices: choiceMap[q.id] ?? [],
    answers: answerMap[q.id] ?? [],
  }))

  return NextResponse.json({ set, questions: questionsWithData })
}

// PUT /api/question-bank/[setId]
// body: { questions: [ { id?, order_num, question_text, question_type, score,
//                        choices: [{choice_num, choice_text}],
//                        answers: [{answer_text, order_num}] } ] }
// → 기존 문항 전부 삭제 후 새로 insert (전체 교체)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const { academyId } = await verifyTeacher(db, token)
  if (!academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { setId } = await params

  // 세트 소유권 확인
  const { data: set } = await db
    .from('qb_sets')
    .select('id')
    .eq('id', setId)
    .eq('academy_id', academyId)
    .single()
  if (!set) return NextResponse.json({ error: '세트를 찾을 수 없어요.' }, { status: 404 })

  const body = await req.json()
  const { questions = [] } = body

  // 기존 문항들 삭제 (cascade로 choices/answers도 삭제됨)
  const { data: oldQs } = await db.from('qb_questions').select('id').eq('set_id', setId)
  const oldIds = (oldQs ?? []).map((q: any) => q.id)
  if (oldIds.length) {
    await db.from('qb_choices').delete().in('question_id', oldIds)
    await db.from('qb_answers').delete().in('question_id', oldIds)
    await db.from('qb_questions').delete().eq('set_id', setId)
  }

  // 새 문항 삽입 (소문제 그룹 지원 — 부모 먼저 삽입 후 자식 삽입)
  if (questions.length > 0) {
    const allChoices: any[] = []
    const allAnswers: any[] = []

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]

      if (q.question_type === 'group') {
        // 그룹 부모 삽입
        const { data: parent, error: pErr } = await db.from('qb_questions').insert({
          set_id: setId,
          order_num: i + 1,
          custom_label: q.custom_label ?? null,
          question_text: null,
          question_type: 'group',
          score: 0,
          group_context: q.group_context ?? null,
        }).select('id').single()

        if (pErr || !parent)
          return NextResponse.json({ error: `그룹 문항 저장 실패: ${pErr?.message}` }, { status: 500 })

        // 자식 문제 순서대로 삽입
        for (let ci = 0; ci < (q.children ?? []).length; ci++) {
          const child = q.children[ci]
          const { data: childQ, error: cErr } = await db.from('qb_questions').insert({
            set_id: setId,
            order_num: ci + 1,
            custom_label: null,
            question_text: child.question_text ?? '',
            question_type: child.question_type,
            score: child.score ?? 1,
            parent_id: parent.id,
          }).select('id').single()

          if (cErr || !childQ)
            return NextResponse.json({ error: `소문제 저장 실패: ${cErr?.message}` }, { status: 500 })

          if (child.choices?.length)
            allChoices.push(...child.choices.map((c: any, ci2: number) => ({
              question_id: childQ.id, choice_num: c.choice_num ?? ci2 + 1, choice_text: c.choice_text ?? '',
            })))
          if (child.answers?.length)
            allAnswers.push(...child.answers.map((a: any, ai: number) => ({
              question_id: childQ.id, answer_text: a.answer_text ?? '', order_num: a.order_num ?? ai + 1,
            })))
        }
      } else {
        // 일반 문제
        const { data: newQ, error: qErr } = await db.from('qb_questions').insert({
          set_id: setId,
          order_num: i + 1,
          custom_label: q.custom_label ?? null,
          question_text: q.question_text ?? '',
          question_type: q.question_type ?? 'multiple_choice',
          score: q.score ?? 1,
        }).select('id').single()

        if (qErr || !newQ)
          return NextResponse.json({ error: `문항 저장 실패: ${qErr?.message}` }, { status: 500 })

        if (q.choices?.length)
          allChoices.push(...q.choices.map((c: any, ci: number) => ({
            question_id: newQ.id, choice_num: c.choice_num ?? ci + 1, choice_text: c.choice_text ?? '',
          })))
        if (q.answers?.length)
          allAnswers.push(...q.answers.map((a: any, ai: number) => ({
            question_id: newQ.id, answer_text: a.answer_text ?? '', order_num: a.order_num ?? ai + 1,
          })))
      }
    }

    if (allChoices.length) {
      const { error: cErr } = await db.from('qb_choices').insert(allChoices)
      if (cErr) return NextResponse.json({ error: `선택지 저장 실패: ${cErr.message}` }, { status: 500 })
    }
    if (allAnswers.length) {
      const { error: aErr } = await db.from('qb_answers').insert(allAnswers)
      if (aErr) return NextResponse.json({ error: `정답 저장 실패: ${aErr.message}` }, { status: 500 })
    }
  }

  // updated_at 갱신
  await db.from('qb_sets').update({ updated_at: new Date().toISOString() }).eq('id', setId)

  return NextResponse.json({ success: true, questionCount: questions.length })
}
