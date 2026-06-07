import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { monthsAgoKST } from '@/lib/date'

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

// 학부모 인증: 토큰 → profiles.phone → students.parent_phone 매칭 (재원 학생만)
async function verifyParent(db: ReturnType<typeof admin>, token: string, studentId: string) {
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return false
  const { data: profile } = await db.from('profiles').select('phone').eq('id', user.id).single()
  if (!profile?.phone) return false
  const { data: linked } = await db.from('students').select('id, status')
    .eq('id', studentId).eq('parent_phone', profile.phone).maybeSingle()
  if (!linked || linked.status === 'inactive') return false
  return true
}

// 학생 인증: 토큰 → students.user_id 매칭 (재원 학생만)
async function verifyStudent(db: ReturnType<typeof admin>, token: string, studentId: string) {
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return false
  const { data: linked } = await db.from('students').select('id, status')
    .eq('id', studentId).eq('user_id', user.id).maybeSingle()
  if (!linked || linked.status === 'inactive') return false
  return true
}

// classId 소속 검증: 해당 학생이 실제로 그 반에 있는지 확인
async function verifyClassAccess(db: ReturnType<typeof admin>, studentId: string, classId: string) {
  const { data } = await db.from('class_students')
    .select('class_id').eq('class_id', classId).eq('student_id', studentId).maybeSingle()
  return !!data
}

// 코멘트 공개 설정 조회 (classId → academyId 자동 조회)
const DEFAULT_VIS = { attStudent: true, attParent: true, hwStudent: true, hwParent: true, clinicStudent: true, clinicParent: true, examStudent: true, examParent: true }
async function getCommentVis(db: ReturnType<typeof admin>, classId: string) {
  const { data: cls } = await db.from('classes').select('academy_id').eq('id', classId).single()
  if (!cls?.academy_id) return DEFAULT_VIS
  const { data } = await db.from('academies')
    .select('comment_vis_att_student, comment_vis_att_parent, comment_vis_hw_student, comment_vis_hw_parent, comment_vis_clinic_student, comment_vis_clinic_parent, comment_vis_exam_student, comment_vis_exam_parent')
    .eq('id', cls.academy_id).single()
  return {
    attStudent:    data?.comment_vis_att_student    ?? true,
    attParent:     data?.comment_vis_att_parent     ?? true,
    hwStudent:     data?.comment_vis_hw_student     ?? true,
    hwParent:      data?.comment_vis_hw_parent      ?? true,
    clinicStudent: data?.comment_vis_clinic_student ?? true,
    clinicParent:  data?.comment_vis_clinic_parent  ?? true,
    examStudent:   data?.comment_vis_exam_student   ?? true,
    examParent:    data?.comment_vis_exam_parent    ?? true,
  }
}

// GET ?action=tests&classId=xxx              → 시험 목록 + 통계
// GET ?action=scores&testId=xxx&classId=xxx  → 특정 시험의 학생별 점수
// GET ?action=student-chart&classId=xxx&studentId=xxx → 학생 상세 성적 그래프+목록
// GET ?action=parent-chart&classId=xxx&studentId=xxx  → 학부모 포털 성적
// GET ?action=parent-clinic&classId=xxx&studentId=xxx → 학부모 포털 클리닉
// GET ?action=my-grades&classId=xxx&studentId=xxx     → 학생 포털 성적
// GET ?action=my-clinic&classId=xxx&studentId=xxx     → 학생 포털 클리닉
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
    if (!await verifyClassAccess(db, studentId, classId)) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const { data: _sr1 } = await db.from('students').select('enrolled_at').eq('id', studentId).single()
    const enrolledAt1 = _sr1?.enrolled_at?.slice(0, 10) ?? '2000-01-01'

    const records: Record<string, unknown>[] = []
    const vis = await getCommentVis(db, classId!)

    // 구시스템
    const { data: tests } = await db.from('tests')
      .select('id, name, max_score, date').eq('class_id', classId).gte('date', enrolledAt1).order('date', { ascending: true })
    if (tests?.length) {
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
      for (const t of tests) {
        const my = myMap[t.id]; const arr = allMap[t.id] ?? []
        const myRaw = (my && !my.absent) ? my.score : null
        const avgRaw = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null
        records.push({
          name: t.name, date: t.date, maxScore: t.max_score,
          myScore: myRaw, myPct: myRaw !== null ? Math.round((myRaw / t.max_score) * 100) : null,
          avgScore: avgRaw !== null ? Math.round(avgRaw * 10) / 10 : null,
          classHigh: arr.length > 0 ? Math.max(...arr) : null,
          classLow: arr.length > 0 ? Math.min(...arr) : null,
          absent: my?.absent ?? false,
        })
      }
    }

    // 신시스템 (마감된 시험 + 마감없는 시험 + 수동채점 active 시험)
    const [{ data: closedExams }, { data: noDeadlineExams }, { data: manualActiveExams }] = await Promise.all([
      db.from('exams').select('id, title, status, start_at, created_at, max_score, exam_type, exam_format, no_deadline, category')
        .eq('class_id', classId).eq('status', 'closed').order('start_at', { ascending: true }),
      db.from('exams').select('id, title, status, start_at, created_at, max_score, exam_type, exam_format, no_deadline, category')
        .eq('class_id', classId).eq('status', 'active').eq('no_deadline', true).order('start_at', { ascending: true }),
      db.from('exams').select('id, title, status, start_at, created_at, max_score, exam_type, exam_format, no_deadline, category')
        .eq('class_id', classId).eq('status', 'active').eq('exam_type', 'manual').order('start_at', { ascending: true }),
    ])
    const seenExamIds1 = new Set<string>()
    const allExams = [...(closedExams ?? []), ...(noDeadlineExams ?? []), ...(manualActiveExams ?? [])].filter((e: any) => {
      if (seenExamIds1.has(e.id)) return false
      seenExamIds1.add(e.id)
      return true
    })
    if (allExams.length) {
      const examIds = allExams.map(e => e.id)
      const [{ data: mySubmissions }, { data: allSubmissions }, { data: examQuestions }] = await Promise.all([
        db.from('exam_submissions').select('exam_id, auto_score, adjusted_score, is_submitted, is_forfeited, note').eq('student_id', studentId).in('exam_id', examIds),
        db.from('exam_submissions').select('exam_id, auto_score, adjusted_score, is_forfeited').eq('is_submitted', true).in('exam_id', examIds),
        db.from('exam_questions').select('exam_id, score').in('exam_id', examIds),
      ])
      const maxScoreByExam: Record<string, number> = {}
      for (const q of (examQuestions ?? [])) { const acc = (maxScoreByExam[q.exam_id] ?? 0) + Number(q.score); maxScoreByExam[q.exam_id] = Math.round(acc * 100) / 100 }
      const mySubMap: Record<string, { auto_score: number | null; adjusted_score: number | null; is_submitted: boolean; is_forfeited: boolean; note: string | null }> = {}
      for (const s of (mySubmissions ?? [])) mySubMap[s.exam_id] = s
      const allScoresByExam: Record<string, number[]> = {}
      for (const s of (allSubmissions ?? [])) {
        if (s.is_forfeited) continue
        const score = s.adjusted_score ?? s.auto_score
        if (score !== null) { if (!allScoresByExam[s.exam_id]) allScoresByExam[s.exam_id] = []; allScoresByExam[s.exam_id].push(score) }
      }
      for (const exam of allExams) {
        const mySub = mySubMap[exam.id]
        // 마감없는 시험은 본인이 제출한 경우에만 차트에 포함 (수동채점 제외)
        if ((exam as any).no_deadline && (exam as any).exam_type !== 'manual' && (!mySub?.is_submitted || mySub?.is_forfeited)) continue
        const myScore = mySub?.is_submitted && !mySub?.is_forfeited ? (mySub.adjusted_score ?? mySub.auto_score) : null
        const examFormat = (exam as any).exam_format ?? 'score'
        // 통과/불통형은 숫자 통계 제외
        const maxScore = examFormat === 'pass_fail' ? null : ((exam as any).max_score ?? maxScoreByExam[exam.id] ?? null)
        const arr = examFormat === 'pass_fail' ? [] : (allScoresByExam[exam.id] ?? [])
        const avgRaw = arr.length > 0 ? arr.reduce((a: number, b: number) => a + b, 0) / arr.length : null
        const dateStr = exam.start_at ? exam.start_at.slice(0, 10) : exam.created_at.slice(0, 10)
        records.push({
          name: exam.title, date: dateStr, maxScore,
          myScore, myPct: myScore !== null && maxScore ? Math.round((myScore / maxScore) * 100) : null,
          avgScore: avgRaw !== null ? Math.round(avgRaw * 10) / 10 : null,
          avgPct: avgRaw !== null && maxScore ? Math.round((avgRaw / maxScore) * 100) : null,
          classHigh: arr.length > 0 ? Math.max(...arr) : null,
          classLow: arr.length > 0 ? Math.min(...arr) : null,
          absent: false,
          examFormat,
          category: (exam as any).category ?? null,
          note: vis.examParent ? (mySub?.note ?? null) : null,
        })
      }
    }

    records.sort((a, b) => ((a.date as string) ?? '').localeCompare((b.date as string) ?? ''))
    return NextResponse.json({ records })
  }

  // ── 학부모 코멘트 ──
  if (action === 'parent-comments') {
    const studentId = searchParams.get('studentId')
    if (!studentId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const ok = await verifyParent(db, token, studentId)
    if (!ok) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const { data: commentRows, error: commentErr } = await db
      .from('comments')
      .select('id, date, content')
      .eq('student_id', studentId)
      .order('date', { ascending: false })

    if (commentErr) return NextResponse.json({ error: commentErr.message }, { status: 400 })

    const records = (commentRows ?? []).map((c: any) => ({
      id:      c.id,
      date:    c.date,
      content: c.content,
    }))

    return NextResponse.json({ records })
  }

  // ── 학부모 과제 ──
  if (action === 'parent-homework') {
    const classId   = searchParams.get('classId')
    const studentId = searchParams.get('studentId')
    if (!classId || !studentId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const ok = await verifyParent(db, token, studentId)
    if (!ok) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })
    if (!await verifyClassAccess(db, studentId, classId)) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const { data: _sr2 } = await db.from('students').select('enrolled_at').eq('id', studentId).single()
    const enrolledAt2 = _sr2?.enrolled_at?.slice(0, 10) ?? '2000-01-01'

    const { data: hwList } = await db.from('homework')
      .select('id, title, assigned_date, due_date, description')
      .eq('class_id', classId)
      .gte('assigned_date', enrolledAt2)
      .order('assigned_date', { ascending: false })

    if (!hwList?.length) return NextResponse.json({ records: [] })

    const hwIds = hwList.map((h: any) => h.id)
    const { data: statuses } = await db.from('homework_status')
      .select('homework_id, status, note')
      .eq('student_id', studentId)
      .in('homework_id', hwIds)

    const statusMap: Record<string, { status: string; note: string | null }> = {}
    for (const s of (statuses ?? [])) statusMap[s.homework_id] = { status: s.status, note: s.note ?? null }

    const vis = await getCommentVis(db, classId!)
    const records = hwList.map((h: any) => ({
      id:            h.id,
      title:         h.title,
      assigned_date: h.assigned_date,
      due_date:      h.due_date ?? null,
      description:   h.description ?? null,
      status:        statusMap[h.id]?.status ?? null,
      note:          vis.hwParent ? (statusMap[h.id]?.note ?? null) : null,
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
    if (!await verifyClassAccess(db, studentId, classId)) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const { data: _sr3 } = await db.from('students').select('enrolled_at').eq('id', studentId).single()
    const enrolledAt3 = _sr3?.enrolled_at?.slice(0, 10) ?? '2000-01-01'

    const [{ data: sessions }, { data: myAtt }] = await Promise.all([
      db.from('clinic_sessions').select('id, name, date, note').eq('class_id', classId).gte('date', enrolledAt3).order('date', { ascending: false }),
      db.from('clinic_attendance').select('clinic_session_id, status').eq('student_id', studentId),
    ])

    const attMap: Record<string, string> = {}
    for (const a of (myAtt ?? [])) attMap[a.clinic_session_id] = a.status

    const vis = await getCommentVis(db, classId!)
    const records = (sessions ?? []).map((s: any) => ({
      id:          s.id,
      date:        s.date,
      clinic_name: s.name ?? null,
      note:        vis.clinicParent ? (s.note ?? null) : null,
      status:      attMap[s.id] ?? null,
    }))

    return NextResponse.json({ records })
  }

  // ── 학생 과제 ──
  if (action === 'my-homework') {
    const classId   = searchParams.get('classId')
    const studentId = searchParams.get('studentId')
    if (!classId || !studentId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const ok = await verifyStudent(db, token, studentId)
    if (!ok) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })
    if (!await verifyClassAccess(db, studentId, classId)) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const { data: _sr4 } = await db.from('students').select('enrolled_at').eq('id', studentId).single()
    const enrolledAt4 = _sr4?.enrolled_at?.slice(0, 10) ?? '2000-01-01'

    const { data: hwList } = await db.from('homework')
      .select('id, title, assigned_date, due_date, description')
      .eq('class_id', classId)
      .gte('assigned_date', enrolledAt4)
      .order('assigned_date', { ascending: false })

    if (!hwList?.length) return NextResponse.json({ records: [] })

    const hwIds = hwList.map((h: any) => h.id)
    const { data: statuses } = await db.from('homework_status')
      .select('homework_id, status, note')
      .eq('student_id', studentId)
      .in('homework_id', hwIds)

    const statusMap: Record<string, { status: string; note: string | null }> = {}
    for (const s of (statuses ?? [])) statusMap[s.homework_id] = { status: s.status, note: s.note ?? null }

    const vis = await getCommentVis(db, classId!)
    const records = hwList.map((h: any) => ({
      id:            h.id,
      title:         h.title,
      assigned_date: h.assigned_date,
      due_date:      h.due_date ?? null,
      description:   h.description ?? null,
      status:        statusMap[h.id]?.status ?? null,
      note:          vis.hwStudent ? (statusMap[h.id]?.note ?? null) : null,
    }))

    return NextResponse.json({ records })
  }

  // ── 학생 포털 출석 ──
  if (action === 'my-attendance') {
    const classId   = searchParams.get('classId')
    const studentId = searchParams.get('studentId')
    if (!classId || !studentId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const ok = await verifyStudent(db, token, studentId)
    if (!ok) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })
    if (!await verifyClassAccess(db, studentId, classId)) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const sixMonthsAgoStr = monthsAgoKST(6)

    // 등록일 조회 — 6개월 전 vs 등록일 중 더 늦은 날짜부터 표시
    const { data: studentRow } = await db.from('students').select('enrolled_at').eq('id', studentId).single()
    const enrolledAt = studentRow?.enrolled_at?.slice(0, 10) ?? sixMonthsAgoStr
    const fromDate = enrolledAt > sixMonthsAgoStr ? enrolledAt : sixMonthsAgoStr

    const { data: sessions } = await db.from('sessions')
      .select('id, date, status')
      .eq('class_id', classId)
      .gte('date', fromDate)
      .order('date', { ascending: false })

    if (!sessions?.length) return NextResponse.json({ records: [] })

    const sessionIds = sessions.map((s: any) => s.id)
    const { data: attRows } = await db.from('attendance')
      .select('session_id, status, note, late_minutes, early_leave_minutes')
      .eq('student_id', studentId)
      .in('session_id', sessionIds)

    const attMap: Record<string, any> = {}
    for (const a of (attRows ?? [])) attMap[a.session_id] = a

    const vis = await getCommentVis(db, classId!)
    const records = sessions.map((s: any) => {
      if (s.status === 'cancelled') return { date: s.date, status: 'cancelled' }
      const a = attMap[s.id]
      return {
        date: s.date,
        status: a?.status ?? 'absent',
        note: vis.attStudent ? (a?.note ?? null) : null,
        late_minutes: a?.late_minutes ?? null,
        early_leave_minutes: a?.early_leave_minutes ?? null,
      }
    })

    return NextResponse.json({ records })
  }

  // ── 학생 포털 성적 ──
  if (action === 'my-grades') {
    const classId   = searchParams.get('classId')
    const studentId = searchParams.get('studentId')
    if (!classId || !studentId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const ok = await verifyStudent(db, token, studentId)
    if (!ok) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })
    if (!await verifyClassAccess(db, studentId, classId)) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const { data: _sr5 } = await db.from('students').select('enrolled_at').eq('id', studentId).single()
    const enrolledAt5 = _sr5?.enrolled_at?.slice(0, 10) ?? '2000-01-01'

    // 구시스템(tests) + 신시스템(exams) 병렬 조회
    // exams: 마감된 시험 OR 마감없는 시험 OR 수동채점 active 시험
    const [{ data: tests }, { data: closedExams }, { data: noDeadlineExams }, { data: manualActiveExams5 }] = await Promise.all([
      db.from('tests').select('id, name, max_score, date').eq('class_id', classId).gte('date', enrolledAt5).order('date', { ascending: true }),
      db.from('exams').select('id, title, status, exam_type, exam_format, answer_reveal, start_at, created_at, max_score, no_deadline, category')
        .eq('class_id', classId).eq('status', 'closed').order('start_at', { ascending: true }),
      db.from('exams').select('id, title, status, exam_type, exam_format, answer_reveal, start_at, created_at, max_score, no_deadline, category')
        .eq('class_id', classId).eq('no_deadline', true).eq('status', 'active').order('start_at', { ascending: true }),
      db.from('exams').select('id, title, status, exam_type, exam_format, answer_reveal, start_at, created_at, max_score, no_deadline, category')
        .eq('class_id', classId).eq('exam_type', 'manual').eq('status', 'active').order('start_at', { ascending: true }),
    ])
    // 중복 제거 + 등록일 이전 시험 제외
    const seenExamIds5 = new Set<string>()
    const exams = [
      ...(closedExams ?? []),
      ...(noDeadlineExams ?? []),
      ...(manualActiveExams5 ?? []),
    ].filter((e: any) => {
      if (seenExamIds5.has(e.id)) return false
      seenExamIds5.add(e.id)
      return true
    }) as any[]

    const records: Record<string, unknown>[] = []
    const vis = await getCommentVis(db, classId!)

    // ── 구시스템 점수 ──
    if (tests?.length) {
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

      for (const t of tests) {
        const my     = myMap[t.id]
        const myRaw  = (my && !my.absent) ? my.score : null
        const absent = my?.absent ?? false
        const arr    = allMap[t.id] ?? []
        const avgRaw = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null
        records.push({
          name:      t.name,
          date:      t.date,
          maxScore:  t.max_score,
          myScore:   myRaw,
          myPct:     myRaw !== null ? Math.round((myRaw / t.max_score) * 100) : null,
          avgScore:  avgRaw !== null ? Math.round(avgRaw * 10) / 10 : null,
          classHigh: arr.length > 0 ? Math.max(...arr) : null,
          classLow:  arr.length > 0 ? Math.min(...arr) : null,
          absent,
        })
      }
    }

    // ── 신시스템 시험 점수 (마감된 것만) ──
    if (exams?.length) {
      const examIds = exams.map(e => e.id)

      const [{ data: mySubmissions }, { data: allSubmissions }, { data: examQuestions }] = await Promise.all([
        db.from('exam_submissions').select('exam_id, auto_score, adjusted_score, is_submitted, is_forfeited, note')
          .eq('student_id', studentId).in('exam_id', examIds),
        db.from('exam_submissions').select('exam_id, auto_score, adjusted_score, is_forfeited')
          .eq('is_submitted', true).in('exam_id', examIds),
        db.from('exam_questions').select('exam_id, score').in('exam_id', examIds),
      ])

      // 시험별 만점 계산
      const maxScoreByExam: Record<string, number> = {}
      for (const q of (examQuestions ?? [])) {
        maxScoreByExam[q.exam_id] = Math.round(((maxScoreByExam[q.exam_id] ?? 0) + Number(q.score)) * 100) / 100
      }

      // 내 제출 맵
      const mySubMap: Record<string, { auto_score: number | null; adjusted_score: number | null; is_submitted: boolean; is_forfeited: boolean; note: string | null }> = {}
      for (const s of (mySubmissions ?? [])) {
        mySubMap[s.exam_id] = { auto_score: s.auto_score, adjusted_score: s.adjusted_score, is_submitted: s.is_submitted, is_forfeited: s.is_forfeited ?? false, note: (s as any).note ?? null }
      }

      // 시험별 전체 점수 목록 (평균·최고·최저용)
      const allScoresByExam: Record<string, number[]> = {}
      for (const s of (allSubmissions ?? [])) {
        if (s.is_forfeited) continue
        const score = s.adjusted_score ?? s.auto_score
        if (score !== null) {
          if (!allScoresByExam[s.exam_id]) allScoresByExam[s.exam_id] = []
          allScoresByExam[s.exam_id].push(score)
        }
      }

      for (const exam of exams) {
        const mySub   = mySubMap[exam.id]
        // 포기한 시험은 성적 표시 안 하고 별도 표시
        const isForfeited = mySub?.is_forfeited ?? false
        // 마감없는 자동채점 시험은 제출한 경우만 표시 (미제출이면 exam tab에서 볼 수 있음)
        if (exam.no_deadline && exam.exam_type !== 'manual' && !mySub?.is_submitted) continue
        const myScore = (mySub?.is_submitted && !isForfeited) ? (mySub.adjusted_score ?? mySub.auto_score) : null
        const isAdjusted = !!(mySub?.is_submitted && !isForfeited && mySub.adjusted_score !== null && mySub.adjusted_score !== mySub.auto_score)
        const examFormat = exam.exam_format ?? 'score'
        // 통과/불통형은 숫자 통계 제외
        const maxScore = examFormat === 'pass_fail' ? null : (exam.max_score ?? maxScoreByExam[exam.id] ?? null)
        const arr     = examFormat === 'pass_fail' ? [] : (allScoresByExam[exam.id] ?? [])
        const avgRaw  = arr.length > 0 ? arr.reduce((a: number, b: number) => a + b, 0) / arr.length : null
        const dateStr = exam.start_at ? exam.start_at.slice(0, 10) : exam.created_at.slice(0, 10)

        // 등수 계산 (점수형만)
        const rank = examFormat !== 'pass_fail' && myScore !== null && arr.length > 0
          ? arr.filter((s: number) => s > myScore).length + 1
          : null
        const totalSubmitted = arr.length

        records.push({
          name:           exam.title,
          date:           dateStr,
          maxScore,
          myScore,
          myPct:          myScore !== null && maxScore ? Math.round((myScore / maxScore) * 100) : null,
          avgScore:       avgRaw !== null ? Math.round(avgRaw * 10) / 10 : null,
          avgPct:         avgRaw !== null && maxScore ? Math.round((avgRaw / maxScore) * 100) : null,
          classHigh:      arr.length > 0 ? Math.max(...arr) : null,
          classLow:       arr.length > 0 ? Math.min(...arr) : null,
          absent:         false,
          isForfeited,
          isAdjusted,
          noDeadline:     exam.no_deadline ?? false,
          examId:         exam.id,
          examType:       exam.exam_type,
          examFormat,
          answerReveal:   exam.answer_reveal,
          category:       exam.category ?? null,
          rank,
          totalSubmitted,
          note:           vis.examStudent ? (mySub?.note ?? null) : null,
        })
      }
    }

    // 날짜순 정렬
    records.sort((a, b) => ((a.date as string) ?? '').localeCompare((b.date as string) ?? ''))

    return NextResponse.json({ records })
  }

  // ── 학생 포털 클리닉 ──
  if (action === 'my-clinic') {
    const classId   = searchParams.get('classId')
    const studentId = searchParams.get('studentId')
    if (!classId || !studentId) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

    const ok = await verifyStudent(db, token, studentId)
    if (!ok) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })
    if (!await verifyClassAccess(db, studentId, classId)) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const { data: _sr6 } = await db.from('students').select('enrolled_at').eq('id', studentId).single()
    const enrolledAt6 = _sr6?.enrolled_at?.slice(0, 10) ?? '2000-01-01'

    const [{ data: sessions }, { data: myAtt }] = await Promise.all([
      db.from('clinic_sessions').select('id, name, date, note').eq('class_id', classId).gte('date', enrolledAt6).order('date', { ascending: false }),
      db.from('clinic_attendance').select('clinic_session_id, status').eq('student_id', studentId),
    ])

    const attMap: Record<string, string> = {}
    for (const a of (myAtt ?? [])) attMap[a.clinic_session_id] = a.status

    const vis = await getCommentVis(db, classId!)
    const records = (sessions ?? []).map((s: any) => ({
      id:          s.id,
      date:        s.date,
      clinic_name: s.name ?? null,
      note:        vis.clinicStudent ? (s.note ?? null) : null,
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

    // 다른 학원 반 점수 접근 차단
    const { data: clsOwn } = await db.from('classes').select('id').eq('id', classId).eq('academy_id', academyId).maybeSingle()
    if (!clsOwn) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

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

    // 다른 학원 반·학생 성적 접근 차단
    const { data: clsOwn } = await db.from('classes').select('id').eq('id', classId).eq('academy_id', academyId).maybeSingle()
    if (!clsOwn) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

    const { data: _sr7 } = await db.from('students').select('enrolled_at').eq('id', studentId).single()
    const enrolledAt7 = _sr7?.enrolled_at?.slice(0, 10) ?? '2000-01-01'

    const points: { name: string; 내점수: number | null; 반평균: number | null }[] = []
    const records: Record<string, unknown>[] = []

    // 구시스템
    const { data: tests } = await db.from('tests')
      .select('id, name, max_score, date').eq('class_id', classId).gte('date', enrolledAt7).order('date', { ascending: true })
    if (tests?.length) {
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
      for (const t of tests) {
        const my = myMap[t.id]; const arr = allMap[t.id] ?? []
        const myRaw = (my && !my.absent) ? my.score : null
        const avgRaw = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null
        points.push({
          name: `${t.date?.slice(5)} ${t.name}`,
          내점수: myRaw !== null ? Math.round((myRaw / t.max_score) * 100) : null,
          반평균: avgRaw !== null ? Math.round(avgRaw / t.max_score * 100) : null,
        })
        records.push({
          name: t.name, date: t.date, maxScore: t.max_score,
          myScore: myRaw, myPct: myRaw !== null ? Math.round((myRaw / t.max_score) * 100) : null,
          avgScore: avgRaw !== null ? Math.round(avgRaw * 10) / 10 : null,
          avgPct: avgRaw !== null ? Math.round(avgRaw / t.max_score * 100) : null,
          classHigh: arr.length > 0 ? Math.max(...arr) : null,
          classLow: arr.length > 0 ? Math.min(...arr) : null,
          absent: my?.absent ?? false,
        })
      }
    }

    // 신시스템 (마감된 시험 + 마감없는 시험 + 수동채점 active 시험)
    const [{ data: closedExams2 }, { data: noDeadlineExams2 }, { data: manualActiveExams2 }] = await Promise.all([
      db.from('exams').select('id, title, status, start_at, created_at, max_score, exam_type, no_deadline, category')
        .eq('class_id', classId).eq('status', 'closed').order('start_at', { ascending: true }),
      db.from('exams').select('id, title, status, start_at, created_at, max_score, exam_type, no_deadline, category')
        .eq('class_id', classId).eq('status', 'active').eq('no_deadline', true).order('start_at', { ascending: true }),
      db.from('exams').select('id, title, status, start_at, created_at, max_score, exam_type, no_deadline, category')
        .eq('class_id', classId).eq('status', 'active').eq('exam_type', 'manual').order('start_at', { ascending: true }),
    ])
    const seenExamIds2 = new Set<string>()
    const allExams2 = [...(closedExams2 ?? []), ...(noDeadlineExams2 ?? []), ...(manualActiveExams2 ?? [])].filter((e: any) => {
      if (seenExamIds2.has(e.id)) return false
      seenExamIds2.add(e.id)
      return true
    })
    if (allExams2.length) {
      const examIds = allExams2.map(e => e.id)
      const [{ data: mySubmissions }, { data: allSubmissions }, { data: examQuestions }] = await Promise.all([
        db.from('exam_submissions').select('exam_id, auto_score, adjusted_score, is_submitted, is_forfeited, note').eq('student_id', studentId).in('exam_id', examIds),
        db.from('exam_submissions').select('exam_id, auto_score, adjusted_score, is_forfeited').eq('is_submitted', true).in('exam_id', examIds),
        db.from('exam_questions').select('exam_id, score').in('exam_id', examIds),
      ])
      const maxScoreByExam: Record<string, number> = {}
      for (const q of (examQuestions ?? [])) { const acc = (maxScoreByExam[q.exam_id] ?? 0) + Number(q.score); maxScoreByExam[q.exam_id] = Math.round(acc * 100) / 100 }
      const mySubMap: Record<string, { auto_score: number | null; adjusted_score: number | null; is_submitted: boolean; is_forfeited: boolean; note: string | null }> = {}
      for (const s of (mySubmissions ?? [])) mySubMap[s.exam_id] = s
      const allScoresByExam: Record<string, number[]> = {}
      for (const s of (allSubmissions ?? [])) {
        if (s.is_forfeited) continue
        const score = s.adjusted_score ?? s.auto_score
        if (score !== null) { if (!allScoresByExam[s.exam_id]) allScoresByExam[s.exam_id] = []; allScoresByExam[s.exam_id].push(score) }
      }
      for (const exam of allExams2) {
        const mySub = mySubMap[exam.id]
        // 마감없는 자동채점 시험은 본인이 제출한 경우에만 차트에 포함
        if ((exam as any).no_deadline && (exam as any).exam_type !== 'manual' && (!mySub?.is_submitted || mySub?.is_forfeited)) continue
        const myScore = mySub?.is_submitted && !mySub?.is_forfeited ? (mySub.adjusted_score ?? mySub.auto_score) : null
        const maxScore = (exam as any).max_score ?? maxScoreByExam[exam.id] ?? null
        const arr = allScoresByExam[exam.id] ?? []
        const avgRaw = arr.length > 0 ? arr.reduce((a: number, b: number) => a + b, 0) / arr.length : null
        const dateStr = exam.start_at ? exam.start_at.slice(0, 10) : exam.created_at.slice(0, 10)
        points.push({
          name: `${dateStr?.slice(5)} ${exam.title}`,
          내점수: myScore !== null && maxScore ? Math.round((myScore / maxScore) * 100) : null,
          반평균: avgRaw !== null && maxScore ? Math.round((avgRaw / maxScore) * 100) : null,
        })
        records.push({
          name: exam.title, date: dateStr, maxScore,
          myScore, myPct: myScore !== null && maxScore ? Math.round((myScore / maxScore) * 100) : null,
          avgScore: avgRaw !== null ? Math.round(avgRaw * 10) / 10 : null,
          avgPct: avgRaw !== null && maxScore ? Math.round((avgRaw / maxScore) * 100) : null,
          classHigh: arr.length > 0 ? Math.max(...arr) : null,
          classLow: arr.length > 0 ? Math.min(...arr) : null,
          absent: false,
          category: (exam as any).category ?? null,
        })
      }
    }

    // 날짜순 정렬
    records.sort((a, b) => ((a.date as string) ?? '').localeCompare((b.date as string) ?? ''))
    points.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

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
