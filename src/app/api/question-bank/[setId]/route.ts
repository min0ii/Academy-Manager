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

  // 문항 목록
  const { data: questions } = await db
    .from('qb_questions')
    .select('id, set_id, order_num, custom_label, question_text, question_type, score')
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

  // 새 문항 insert
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const { data: newQ, error: qErr } = await db
      .from('qb_questions')
      .insert({
        set_id: setId,
        order_num: i + 1,
        custom_label: q.custom_label ?? null,
        question_text: q.question_text ?? '',
        question_type: q.question_type ?? 'multiple_choice',
        score: q.score ?? 1,
      })
      .select('id')
      .single()
    if (qErr || !newQ)
      return NextResponse.json({ error: `문항 ${i + 1} 저장 실패: ${qErr?.message}` }, { status: 500 })

    // 보기 insert
    if (q.choices?.length) {
      const { error: cErr } = await db.from('qb_choices').insert(
        q.choices.map((c: any, ci: number) => ({
          question_id: newQ.id,
          choice_num: c.choice_num ?? ci + 1,
          choice_text: c.choice_text ?? '',
        }))
      )
      if (cErr) return NextResponse.json({ error: `문항 ${i + 1} 선택지 저장 실패: ${cErr.message}` }, { status: 500 })
    }
    // 정답 insert
    if (q.answers?.length) {
      const { error: aErr } = await db.from('qb_answers').insert(
        q.answers.map((a: any, ai: number) => ({
          question_id: newQ.id,
          answer_text: a.answer_text ?? '',
          order_num: a.order_num ?? ai + 1,
        }))
      )
      if (aErr) return NextResponse.json({ error: `문항 ${i + 1} 정답 저장 실패: ${aErr.message}` }, { status: 500 })
    }
  }

  // updated_at 갱신
  await db.from('qb_sets').update({ updated_at: new Date().toISOString() }).eq('id', setId)

  return NextResponse.json({ success: true, questionCount: questions.length })
}
