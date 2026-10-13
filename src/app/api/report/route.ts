import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

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
  return m?.academy_id ?? null
}

// 추이 그래프에 보여줄 회차 수. 리포트 기간이 1주라도 흐름은 보여야 해서
// 기간과 무관하게 '리포트 종료일까지의 최근 N회'를 쓴다.
const CHART_POINTS = 8

// GET /api/report?classId=&from=&to=&category=
// 한 반 학생 전체의 리포트 데이터를 한 번에 돌려준다 (학생 전환·일괄 생성용)
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: '서버 설정이 올바르지 않아요.' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const academyId = await verifyTeacher(db, token)
  if (!academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const classId  = sp.get('classId')
  const from     = sp.get('from')
  const to       = sp.get('to')
  const category = sp.get('category') ?? ''          // 추이 그래프에 쓸 종류
  const sumCategory = sp.get('sumCategory') ?? '예제 점수'   // 기간 합산으로 묶을 종류
  if (!classId || !from || !to)
    return NextResponse.json({ error: '반과 기간을 선택해 주세요.' }, { status: 400 })

  // 다른 학원 반 접근 차단
  const { data: cls } = await db.from('classes')
    .select('id, name').eq('id', classId).eq('academy_id', academyId).maybeSingle()
  if (!cls) return NextResponse.json({ error: '반을 찾을 수 없어요.' }, { status: 404 })

  // ── 학생
  const { data: csRows } = await db.from('class_students')
    .select('student_id, students!inner(id, name, grade, school_name, status)')
    .eq('class_id', classId).eq('students.status', 'active')
  const students = (csRows ?? [])
    .map((r: any) => r.students).filter(Boolean)
    .sort((a: any, b: any) => a.name.localeCompare(b.name, 'ko'))
  const studentIds = students.map((s: any) => s.id)
  if (studentIds.length === 0)
    return NextResponse.json({ className: cls.name, teachers: [], students: [], categories: [] })

  // ── 선생님 목록 (리포트 머리글에 넣을 담당 선생님 고르기용)
  const { data: tRows } = await db.from('academy_teachers')
    .select('teacher_id, title, profiles(name)').eq('academy_id', academyId)
  const teachers = (tRows ?? []).map((t: any) => ({
    id: t.teacher_id, name: t.profiles?.name ?? '', title: t.title ?? '',
  })).filter((t: any) => t.name)

  // ── 출결
  const { data: sessions } = await db.from('sessions')
    .select('id, date, status').eq('class_id', classId)
    .gte('date', from).lte('date', to).order('date')
  const sessIds = (sessions ?? []).map(s => s.id)
  const { data: attRows } = sessIds.length
    ? await db.from('attendance').select('session_id, student_id, status').in('session_id', sessIds)
    : { data: [] as any[] }
  const attBy: Record<string, Record<string, string>> = {}
  for (const a of (attRows ?? []) as any[]) (attBy[a.student_id] ??= {})[a.session_id] = a.status

  // ── 과제
  const { data: homework } = await db.from('homework')
    .select('id, title, assigned_date').eq('class_id', classId)
    .gte('assigned_date', from).lte('assigned_date', to).order('assigned_date')
  const hwIds = (homework ?? []).map(h => h.id)
  const { data: hwRows } = hwIds.length
    ? await db.from('homework_status').select('homework_id, student_id, status').in('homework_id', hwIds)
    : { data: [] as any[] }
  const hwBy: Record<string, Record<string, string>> = {}
  for (const h of (hwRows ?? []) as any[]) (hwBy[h.student_id] ??= {})[h.homework_id] = h.status

  // ── 클리닉
  const { data: clinics } = await db.from('clinic_sessions')
    .select('id, date, name').eq('class_id', classId)
    .gte('date', from).lte('date', to).order('date')
  const clIds = (clinics ?? []).map(c => c.id)
  const { data: clRows } = clIds.length
    ? await db.from('clinic_attendance').select('clinic_session_id, student_id, status').in('clinic_session_id', clIds)
    : { data: [] as any[] }
  const clBy: Record<string, Record<string, string>> = {}
  for (const c of (clRows ?? []) as any[]) (clBy[c.student_id] ??= {})[c.clinic_session_id] = c.status

  // ── 시험: 이 반에 실제로 있는 카테고리 목록도 같이 준다
  const { data: allExams } = await db.from('exams')
    .select('id, title, category, start_at').eq('class_id', classId).order('start_at')
  const categories = Array.from(new Set((allExams ?? [])
    .map(e => (e.category ?? '').trim()).filter(Boolean)))

  // 점수 계산에 쓸 시험 = 기간 안에 있는 모든 시험 + 그래프용 카테고리의 과거분
  const allIds = (allExams ?? []).map(e => e.id)

  // 문항 점수 합 = 만점 (앱 화면과 같은 방식)
  const { data: qRows } = allIds.length
    ? await db.from('exam_questions').select('exam_id, score').in('exam_id', allIds)
    : { data: [] as any[] }
  const fullOf: Record<string, number> = {}
  for (const q of (qRows ?? []) as any[]) fullOf[q.exam_id] = (fullOf[q.exam_id] ?? 0) + Number(q.score ?? 0)

  const { data: subRows } = allIds.length
    ? await db.from('exam_submissions')
        .select('exam_id, student_id, auto_score, adjusted_score, is_submitted, is_forfeited')
        .in('exam_id', allIds).in('student_id', studentIds)
    : { data: [] as any[] }
  const scoreOf: Record<string, Record<string, number | null>> = {}   // student → exam → 점수
  for (const s of (subRows ?? []) as any[]) {
    const v = s.is_forfeited || !s.is_submitted ? null : (s.adjusted_score ?? s.auto_score ?? null)
    ;(scoreOf[s.student_id] ??= {})[s.exam_id] = v === null ? null : Number(v)
  }

  const sumFor = (sid: string, ids: string[]) => {
    let sum = 0, any = false
    for (const id of ids) {
      const v = scoreOf[sid]?.[id]
      if (v !== null && v !== undefined) { sum += v; any = true }
    }
    return any ? Math.round(sum * 100) / 100 : null
  }

  // 시험 묶음 하나(= 같은 날 같은 종류)에 대한 본인·반평균·반최고·만점
  function rowFor(ids: string[], label: string) {
    const full = ids.reduce((a, id) => a + (fullOf[id] ?? 0), 0)
    const all  = studentIds.map(sid => sumFor(sid, ids)).filter((v): v is number => v !== null)
    return {
      label,
      ids,
      full: full > 0 ? Math.round(full * 100) / 100 : null,
      avg: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : null,
      max: all.length ? Math.max(...all) : null,
    }
  }

  // 기간 안에 데이터가 있는 종류만, 종류별로 줄을 만든다.
  // sumCategory 는 기간 전체를 한 줄로 합치고, 나머지는 시험 본 날짜마다 한 줄.
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  const dayLabel = (d: string) => {
    const dt = new Date(d + 'T00:00:00')
    return `${dt.getMonth() + 1}/${dt.getDate()}(${DAYS[dt.getDay()]})`
  }
  const scoreBlocks = categories.map(cat => {
    const inRange = (allExams ?? []).filter(e => {
      if ((e.category ?? '').trim() !== cat) return false
      const d = (e.start_at ?? '').slice(0, 10)
      return d >= from && d <= to
    })
    if (inRange.length === 0) return null

    const byDay: Record<string, string[]> = {}
    for (const e of inRange) (byDay[(e.start_at ?? '').slice(0, 10)] ??= []).push(e.id)
    const days = Object.keys(byDay).sort()

    const rows = cat === sumCategory
      ? [rowFor(inRange.map(e => e.id), days.length > 1 ? `기간 합산 (${inRange.length}회)` : dayLabel(days[0]))]
      : days.map(d => rowFor(byDay[d], dayLabel(d)))

    return { category: cat, mode: cat === sumCategory ? 'sum' : 'each', rows }
  }).filter(Boolean) as { category: string; mode: string; rows: ReturnType<typeof rowFor>[] }[]

  // 그래프에 쓸 종류의 시험 (과거분 포함)
  const examsOfCat = (allExams ?? []).filter(e => (e.category ?? '').trim() === category)

  // ── 추이 그래프: 종료일까지의 최근 N회를 날짜별로 묶어 100점 환산
  const byDate: Record<string, string[]> = {}
  for (const e of examsOfCat) {
    const d = (e.start_at ?? '').slice(0, 10)
    if (!d || d > to) continue
    ;(byDate[d] ??= []).push(e.id)
  }
  const chartDates = Object.keys(byDate).sort().slice(-CHART_POINTS)
  const chartMeta = chartDates.map(d => {
    const ids  = byDate[d]
    const full = ids.reduce((a, id) => a + (fullOf[id] ?? 0), 0)
    const all  = studentIds.map(sid => sumFor(sid, ids)).filter((v): v is number => v !== null)
    const avg  = all.length && full > 0 ? Math.round((all.reduce((a, b) => a + b, 0) / all.length / full) * 100) : null
    return { date: d, ids, full, avg }
  })

  // ── 코멘트 (기간 안에 쓴 것 중 가장 최근 것)
  const { data: cmRows } = await db.from('comments')
    .select('student_id, content, date').in('student_id', studentIds)
    .gte('date', from).lte('date', to).order('date')
  const commentOf: Record<string, string> = {}
  for (const c of (cmRows ?? []) as any[]) commentOf[c.student_id] = c.content

  // ──────────────────────────── 학생별로 조립
  const payload = students.map((st: any) => ({
    id: st.id,
    name: st.name,
    grade: st.grade ?? '',
    schoolName: st.school_name ?? '',
    attendance: (sessions ?? []).map(s => ({
      date: s.date,
      status: s.status === 'cancelled' ? 'cancelled' : (attBy[st.id]?.[s.id] ?? null),
    })),
    homework: (homework ?? []).map(h => ({
      date: h.assigned_date, title: h.title,
      status: hwBy[st.id]?.[h.id] ?? null,
    })),
    clinics: (clinics ?? []).map(c => ({
      date: c.date, name: c.name || '클리닉',
      status: clBy[st.id]?.[c.id] ?? null,
    })),
    // 종류별 점수 — 기간 안에 데이터가 있는 종류만 들어온다
    scores: scoreBlocks.map(b => ({
      category: b.category,
      mode: b.mode,
      rows: b.rows.map(r => ({
        label: r.label, my: sumFor(st.id, r.ids),
        avg: r.avg, max: r.max, full: r.full,
      })),
    })),
    chart: chartMeta.map(m => ({
      date: m.date,
      mine: (() => {
        const v = sumFor(st.id, m.ids)
        return v !== null && m.full > 0 ? Math.round((v / m.full) * 100) : null
      })(),
      classAvg: m.avg,
    })),
    comment: commentOf[st.id] ?? '',
  }))

  return NextResponse.json({
    className: cls.name,
    teachers, categories, from, to, category, sumCategory,
    students: payload,
  })
}
