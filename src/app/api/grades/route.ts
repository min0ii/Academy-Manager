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

// 학부모 인증: 토큰 → profiles.phone → students.parent_phone 매칭
async function verifyParent(db: ReturnType<typeof admin>, token: string, studentId: string) {
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return false
  const { data: profile } = await db.from('profiles').select('phone').eq('id', user.id).single()
  if (!profile?.phone) return false
  const { data: linked } = await db.from('students').select('id')
    .eq('id', studentId).eq('parent_phone', profile.phone).maybeSingle()
  return !!linked
}

// GET ?action=tests&classId=xxx              → 시험 목록 + 통계
// GET ?action=scores&testId=xxx&classId=xxx  → 특정 시험의 학생별 점수
// GET ?action=student-chart&classId=xxx&studentId=xxx → 학생 상세 성적 그래프+목록
// GET ?action=parent-chart&classId=xxx&studentId=xxx  → 학부모 포털 성적
// GET ?action=parent-clinic&classId=xxx&studentId=xxx → 학부모 포털 클리닉
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  // ════════════════════════════════════════════
  // 학부모 전용 액션 (선생님 인증 없이, 자녀 연결만 확인)
  // ════════════════════════════════════════════

  // ── 학부모 성적 ──
  if (action === 'parent-chart') {
    const classId   = searchParams.get('classId')
    const studentId = searchParams.get('studentId')
    if (!classId || !studentId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const ok = await verifyParent(db, token, studentId)
    if (!ok) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const { data: tests } = await db.from('tests')
      .select('id, name, max_score, date').eq('class_id', classId).order('date', { ascending: true })

    if (!tests?.length) return NextResponse.json({ records: [] })

    const testIds = tests.map(t => t.id)
    const [{ data: myScores }, { data: allScores }] = await Promise.all([
      db.from('test_scores').select('test_id, score, absent').eq('student_id', studentId).in('test_id', testIds),
      db.from('test_scores').select('test_id, score').eq('absent', false).in('test_id', testIds),
    ])

    const myMap: Record<string, { score: number; absent: boolean }> = {}
    for (const s of (myScores ?? [])) myMap[s.test_id] = { score: s.score, absent: s.absent }

    const allMap: Record<string, number[]> = {}
    for (const s of (allScores ?? [])) {
      if (!allMap[s.test_id]) allMap[s.test_id] = []
      allMap[s.test_id].push(s.score)
    }

    const records = tests.map(t => {
      const my     = myMap[t.id]
      const myRaw  = (my && !my.absent) ? my.score : null
      const absent = my?.absent ?? false
      const arr    = allMap[t.id] ?? []
      const avgRaw = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null
      return {
        name:      t.name,
        date:      t.date,
        maxScore:  t.max_score,
        myScore:   myRaw,
        myPct:     myRaw !== null ? Math.round((myRaw / t.max_score) * 100) : null,
        avgScore:  avgRaw !== null ? Math.round(avgRaw * 10) / 10 : null,
        classHigh: arr.length > 0 ? Math.max(...arr) : null,
        classLow:  arr.length > 0 ? Math.min(...arr) : null,
        absent,
      }
    })

    return NextResponse.json({ records })
  }

  // ── 학부모 코멘트 ──
  if (action === 'parent-comments') {
    const studentId = searchParams.get('studentId')
    if (!studentId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const ok = await verifyParent(db, token, studentId)
    if (!ok) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    // ① 코멘트 목록 조회 (조인 없이)
    const { data: commentRows, error: commentErr } = await db
      .from('comments')
      .select('id, date, content, teacher_id')
      .eq('student_id', studentId)
      .order('date', { ascending: false })

    if (commentErr) return NextResponse.json({ error: commentErr.message }, { status: 400 })
    if (!commentRows?.length) return NextResponse.json({ records: [] })

    // ② teacher_id 목록으로 profiles 조회
    const teacherIds = [...new Set(commentRows.map((c: any) => c.teacher_id).filter(Boolean))]
    const { data: profileRows } = await db
      .from('profiles')
      .select('id, name, title')
      .in('id', teacherIds)

    const profileMap: Record<string, { name: string; title: string | null }> = {}
    for (const p of (profileRows ?? [])) profileMap[p.id] = { name: p.name, title: p.title }

    const records = commentRows.map((c: any) => ({
      id:            c.id,
      date:          c.date,
      content:       c.content,
      teacher_name:  profileMap[c.teacher_id]?.name ?? null,
      teacher_title: profileMap[c.teacher_id]?.title ?? null,
    }))

    return NextResponse.json({ records })
  }

  // ── 학부모 클리닉 ──
  if (action === 'parent-clinic') {
    const classId   = searchParams.get('classId')
    const studentId = searchParams.get('studentId')
    if (!classId || !studentId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const ok = await verifyParent(db, token, studentId)
    if (!ok) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const [{ data: sessions }, { data: myAtt }] = await Promise.all([
      db.from('clinic_sessions').select('id, name, date, note').eq('class_id', classId).order('date', { ascending: false }),
      db.from('clinic_attendance').select('clinic_session_id, status').eq('student_id', studentId),
    ])

    const attMap: Record<string, string> = {}
    for (const a of (myAtt ?? [])) attMap[a.clinic_session_id] = a.status

    const records = (sessions ?? []).map((s: any) => ({
      id:          s.id,
      date:        s.date,
      clinic_name: s.name ?? null,
      note:        s.note ?? null,
      status:      attMap[s.id] ?? null,
    }))

    return NextResponse.json({ records })
  }

  // ════════════════════════════════════════════
  // 선생님 전용 액션
  // ════════════════════════════════════════════
  const academyId = await verifyTeacher(db, token)
  if (!academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

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

  // ── 학생 상세 페이지 성적 그래프 + 점수 목록 (RLS 우회) ──
  if (action === 'student-chart') {
    const classId   = searchParams.get('classId')
    const studentId = searchParams.get('studentId')
    if (!classId || !studentId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const { data: tests } = await db.from('tests')
      .select('id, name, max_score, date').eq('class_id', classId).order('date', { ascending: true })

    if (!tests?.length) return NextResponse.json({ points: [], records: [] })

    const testIds = tests.map(t => t.id)
    const [{ data: myScores }, { data: allScores }] = await Promise.all([
      db.from('test_scores').select('test_id, score, absent').eq('student_id', studentId).in('test_id', testIds),
      db.from('test_scores').select('test_id, score').eq('absent', false).in('test_id', testIds),
    ])

    const myMap: Record<string, { score: number; absent: boolean }> = {}
    for (const s of (myScores ?? [])) myMap[s.test_id] = { score: s.score, absent: s.absent }

    const allMap: Record<string, number[]> = {}
    for (const s of (allScores ?? [])) {
      if (!allMap[s.test_id]) allMap[s.test_id] = []
      allMap[s.test_id].push(s.score)
    }

    // 그래프용 (퍼센트)
    const points = tests.map(t => {
      const my     = myMap[t.id]
      const myRaw  = (my && !my.absent) ? my.score : null
      const myPct  = myRaw !== null ? Math.round((myRaw / t.max_score) * 100) : null
      const arr    = allMap[t.id] ?? []
      const avgPct = arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / t.max_score * 100) : null
      return { name: t.name, 내점수: myPct, 반평균: avgPct }
    })

    // 목록용 (실제 점수 + 날짜 + 반 최고/최저)
    const records = tests.map(t => {
      const my     = myMap[t.id]
      const myRaw  = (my && !my.absent) ? my.score : null
      const absent = my?.absent ?? false
      const arr    = allMap[t.id] ?? []
      const avgRaw = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null
      return {
        name:      t.name,
        date:      t.date,
        maxScore:  t.max_score,
        myScore:   myRaw,
        myPct:     myRaw !== null ? Math.round((myRaw / t.max_score) * 100) : null,
        avgScore:  avgRaw !== null ? Math.round(avgRaw * 10) / 10 : null,
        avgPct:    avgRaw !== null ? Math.round(avgRaw / t.max_score * 100) : null,
        classHigh: arr.length > 0 ? Math.max(...arr) : null,
        classLow:  arr.length > 0 ? Math.min(...arr) : null,
        absent,
      }
    })

    return NextResponse.json({ points, records })
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
