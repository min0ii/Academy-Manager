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
  const { data: m } = await db.from('academy_teachers').select('academy_id').eq('teacher_id', user.id).single()
  return m?.academy_id ?? null
}

// GET ?action=tests&classId=xxx  → 시험 목록 + 통계
// GET ?action=scores&testId=xxx&classId=xxx → 특정 시험의 학생별 점수
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const academyId = await verifyTeacher(db, token)
  if (!academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  // ── 시험 목록 + 통계 ──
  if (action === 'tests') {
    const classId = searchParams.get('classId')
    if (!classId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const { data: cls } = await db.from('classes').select('id').eq('id', classId).eq('academy_id', academyId).single()
    if (!cls) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const { data: tests } = await db.from('tests')
      .select('id, name, max_score, date').eq('class_id', classId).order('date', { ascending: true })

    if (!tests?.length) return NextResponse.json({ tests: [] })

    const { data: allScores } = await db.from('test_scores')
      .select('test_id, score, absent').in('test_id', tests.map(t => t.id))

    const byTest = new Map<string, { score: number; absent: boolean }[]>()
    for (const s of (allScores ?? [])) {
      if (!byTest.has(s.test_id)) byTest.set(s.test_id, [])
      byTest.get(s.test_id)!.push(s)
    }

    const result = tests.map(t => {
      const sc = byTest.get(t.id) ?? []
      const valid = sc.filter(s => !s.absent).map(s => s.score)
      return {
        id: t.id, name: t.name, max_score: t.max_score, date: t.date,
        takers: sc.length,
        avgScore: valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null,
      }
    })
    return NextResponse.json({ tests: result })
  }

  // ── 특정 시험 점수 + 수업 학생 목록 ──
  if (action === 'scores') {
    const testId = searchParams.get('testId')
    const classId = searchParams.get('classId')
    if (!testId || !classId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const [{ data: students }, { data: scores }] = await Promise.all([
      db.from('class_students').select('students(id, name)').eq('class_id', classId),
      db.from('test_scores').select('student_id, score, absent').eq('test_id', testId),
    ])
    return NextResponse.json({ students: students ?? [], scores: scores ?? [] })
  }

  return NextResponse.json({ error: '잘못된 action' }, { status: 400 })
}

// POST { testId, scores: [{student_id, score, absent}] } → 점수 저장
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const academyId = await verifyTeacher(db, token)
  if (!academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { testId, scores } = await req.json()
  if (!testId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

  // 이 시험이 해당 학원 소속인지 확인
  const { data: testRow } = await db.from('tests')
    .select('id, classes(academy_id)').eq('id', testId).single()
  if (!testRow || (testRow as any).classes?.academy_id !== academyId)
    return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  // 저장할 점수가 하나도 없으면 삭제하지 않고 그냥 성공 반환 (실수 방지)
  if (!scores?.length) return NextResponse.json({ success: true })

  // 새 데이터 먼저 INSERT 성공 확인 후 기존 삭제 (데이터 유실 방지)
  const rows = (scores as any[]).map(s => ({
    test_id: testId, student_id: s.student_id, score: s.score, absent: s.absent,
  }))

  // 기존 점수 삭제
  const { error: delErr } = await db.from('test_scores').delete().eq('test_id', testId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 })

  // 새 점수 삽입
  const { error: insErr } = await db.from('test_scores').insert(rows)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
