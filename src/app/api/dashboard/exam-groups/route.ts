import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: { user } } = await db.auth.getUser(token)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await db
    .from('academy_teachers')
    .select('academy_id')
    .eq('teacher_id', user.id)
    .single()
  if (!membership) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const classId = searchParams.get('classId')
  if (!classId) return Response.json({ error: 'classId required' }, { status: 400 })

  // 반이 내 학원 소속인지 확인
  const { data: cls } = await db
    .from('classes')
    .select('academy_id')
    .eq('id', classId)
    .single()
  if (!cls || cls.academy_id !== membership.academy_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 최근 7일 (KST 기준) → UTC로 변환해서 쿼리
  const nowKST = new Date(Date.now() + 9 * 3600 * 1000)
  const cutoffKST = new Date(nowKST)
  cutoffKST.setDate(nowKST.getDate() - 6)
  cutoffKST.setUTCHours(0, 0, 0, 0)
  const since = new Date(cutoffKST.getTime() - 9 * 3600 * 1000) // UTC

  // 시험 목록 (active + closed, start_at 있는 것만)
  const { data: exams } = await db
    .from('exams')
    .select('id, title, category, start_at, exam_type, max_score')
    .eq('class_id', classId)
    .in('status', ['active', 'closed'])
    .gte('start_at', since.toISOString())
    .not('start_at', 'is', null)
    .order('start_at', { ascending: true })

  if (!exams || exams.length === 0) {
    return Response.json({ dates: [], groups: [] })
  }

  // (KST 날짜, 카테고리) 기준으로 그룹핑
  const groupMap = new Map<string, {
    date: string
    category: string | null
    exams: typeof exams
  }>()

  for (const exam of exams) {
    const kstMs = new Date(exam.start_at!).getTime() + 9 * 3600 * 1000
    const dateStr = new Date(kstMs).toISOString().slice(0, 10)
    const key = `${dateStr}::${exam.category ?? '__none__'}`
    if (!groupMap.has(key)) {
      groupMap.set(key, { date: dateStr, category: exam.category ?? null, exams: [] })
    }
    groupMap.get(key)!.exams.push(exam)
  }

  const validGroups = Array.from(groupMap.values())
  if (validGroups.length === 0) {
    return Response.json({ dates: [], groups: [] })
  }

  // 필요한 데이터 병렬 조회
  const allExamIds = validGroups.flatMap(g => g.exams.map(e => e.id))

  const [{ data: subs }, { data: classStudentsRaw }] = await Promise.all([
    db.from('exam_submissions')
      .select('exam_id, student_id, auto_score, adjusted_score, is_submitted, is_forfeited')
      .in('exam_id', allExamIds),
    db.from('class_students')
      .select('student_id, students!inner(id, name, status)')
      .eq('class_id', classId)
      .eq('students.status', 'active'),
  ])

  const classStudents = (classStudentsRaw ?? []).map(cs => ({
    id: cs.student_id,
    name: (cs.students as unknown as { id: string; name: string; status: string }).name,
  }))

  // 제출 점수 맵: examId → studentId → score (null = 포기)
  const subMap: Record<string, Record<string, number | null>> = {}
  for (const sub of subs ?? []) {
    if (!subMap[sub.exam_id]) subMap[sub.exam_id] = {}
    if (sub.is_forfeited) {
      subMap[sub.exam_id][sub.student_id] = null
    } else if (sub.is_submitted) {
      subMap[sub.exam_id][sub.student_id] = sub.adjusted_score ?? sub.auto_score ?? 0
    }
  }

  // 그룹별 학생 점수 + 순위 계산
  const groups = validGroups.map(group => {
    const examList = group.exams

    const studentRows = classStudents
      .map(student => {
        const scores = examList.map(e => subMap[e.id]?.[student.id] ?? null)
        const submitted = scores.filter((s): s is number => s !== null)
        const total = submitted.length > 0 ? submitted.reduce((a, b) => a + b, 0) : null
        return { studentId: student.id, name: student.name, scores, total }
      })
      .filter(s => s.scores.some(sc => sc !== null)) // 최소 1개 이상 제출한 학생만

    // 합계 내림차순 정렬 후 순위 계산 (동점 공동순위)
    const withRank = studentRows.map(s => {
      if (s.total === null) return { ...s, rank: null as number | null }
      const rank = studentRows.filter(o => o.total !== null && o.total > s.total!).length + 1
      return { ...s, rank }
    }).sort((a, b) => {
      if (a.rank === null) return 1
      if (b.rank === null) return -1
      return a.rank - b.rank
    })

    return {
      date: group.date,
      category: group.category, // null = 미설정
      exams: examList.map((e, i) => ({ id: e.id, title: e.title, order: i + 1 })),
      students: withRank,
    }
  })

  // 날짜 목록 (최신순)
  const dates = [...new Set(groups.map(g => g.date))].sort((a, b) => b.localeCompare(a))

  return Response.json({ dates, groups })
}
