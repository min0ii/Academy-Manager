// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

type LivesRule = {
  condition_type: string
  condition_detail: Record<string, unknown>
  delta: number
}

export function checkCondition(
  rule: LivesRule,
  eventType: string,
  eventDetail: Record<string, unknown>
): boolean {
  const d = rule.condition_detail

  if (eventType === 'attendance') {
    const statuses = Array.isArray(d.statuses)
      ? (d.statuses as string[])
      : (d.status ? [d.status as string] : [])
    return statuses.includes(eventDetail.status as string)
  }

  if (eventType === 'homework' || eventType === 'clinic') {
    return d.status === eventDetail.status
  }

  if (eventType === 'exam_score') {
    const category = d.category as string | null
    if (category && category !== eventDetail.category) return false

    const examSubType = (d.examSubType as string) ?? 'score'

    if (examSubType === 'not_submitted') {
      return eventDetail.isSubmitted === false
    }

    if (examSubType === 'pass_fail') {
      if (eventDetail.examFormat !== 'pass_fail') return false
      const score = eventDetail.score as number
      return d.result === 'pass' ? score === 1 : score === 0
    }

    if (eventDetail.examFormat === 'pass_fail') return false
    const score = eventDetail.score as number | null
    const maxScore = eventDetail.maxScore as number | null
    if (score === null) return false

    const scoreType = (d.scoreType as string) ?? 'pct'
    const val = d.value as number
    const op = d.operator as string
    const compareVal = scoreType === 'raw' ? score : (maxScore && maxScore > 0 ? (score / maxScore) * 100 : 0)
    if (scoreType === 'pct' && (!maxScore || maxScore <= 0)) return false

    if (op === 'lt') return compareVal < val
    if (op === 'lte') return compareVal <= val
    if (op === 'gte') return compareVal >= val
    if (op === 'gt') return compareVal > val
  }
  return false
}

function buildRuleReason(rule: LivesRule & { name?: string }): string {
  const d = rule.condition_detail
  if (rule.condition_type === 'attendance') {
    const statuses = Array.isArray(d.statuses) ? (d.statuses as string[]) : (d.status ? [d.status as string] : [])
    const label: Record<string, string> = { present: '출석', late: '지각', early_leave: '조퇴', absent: '결석' }
    return statuses.map(s => label[s] ?? s).join('/') + ' 처리됨'
  }
  if (rule.condition_type === 'homework') {
    const label: Record<string, string> = { done: '과제 완료', partial: '과제 오답 완료', none: '과제 미완료', unrecorded: '과제 미기록' }
    return label[d.status as string] ?? '과제'
  }
  if (rule.condition_type === 'clinic') {
    return d.status === 'done' ? '클리닉 완료' : '클리닉 미완료'
  }
  if (rule.condition_type === 'exam_score') {
    const cat = d.category ? ` [${d.category}]` : ''
    const examSubType = (d.examSubType as string) ?? 'score'
    if (examSubType === 'not_submitted') return `시험${cat} 미제출`
    if (examSubType === 'pass_fail')
      return `시험${cat} ${d.result === 'pass' ? '통과' : '불통'}`
    const unit = (d.scoreType as string) === 'raw' ? '점' : '%'
    const opLabel: Record<string, string> = { lt: '미만', lte: '이하', gte: '이상', gt: '초과' }
    return `시험${cat} ${d.value}${unit} ${opLabel[d.operator as string] ?? ''}`
  }
  return rule.name ?? '규칙 적용'
}

// ─────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────
type LogEntry = {
  academy_id: string; student_id: string
  delta: number; reason: string; source: string
  lives_after: number; created_at: string
}

function makeEntry(academyId: string, studentId: string, rule: any, created_at: string): LogEntry {
  return {
    academy_id: academyId, student_id: studentId,
    delta: rule.delta, reason: buildRuleReason(rule),
    source: 'rule', lives_after: 0, created_at,
  }
}

async function flushStudent(db: DB, academyId: string, studentId: string, logEntries: LogEntry[]) {
  logEntries.sort((a, b) => a.created_at.localeCompare(b.created_at))
  let acc = 0
  for (const e of logEntries) { acc += e.delta; e.lives_after = acc }

  await db.from('student_lives').upsert(
    { academy_id: academyId, student_id: studentId, lives: acc, updated_at: new Date().toISOString() },
    { onConflict: 'academy_id,student_id' }
  )
  if (logEntries.length > 0) await db.from('student_lives_log').insert(logEntries)
}

// 시험 규칙 적용 — 이벤트 하나당 최대 하나의 규칙만 적용
// 1) 미제출 규칙 먼저: 매칭되면 끝
// 2) 점수 규칙: 위에서부터 첫 번째 매칭만 적용
function applyExamRules(
  examRules: any[],
  exam: any,
  sub: any,
  maxScore: number | null,
  academyId: string,
  studentId: string,
  examDate: string,
  logEntries: LogEntry[]
) {
  const isSubmitted = !!(sub && sub.is_submitted && !sub.is_forfeited)

  // 1) 미제출 규칙 (first match)
  for (const rule of examRules) {
    if ((rule.condition_detail.examSubType as string) !== 'not_submitted') continue
    if (checkCondition(rule, 'exam_score', { isSubmitted, category: exam.category ?? null })) {
      logEntries.push(makeEntry(academyId, studentId, rule, `${examDate}T12:00:00.000Z`))
      return
    }
  }

  // 2) 점수/통과·불통 규칙 (미제출이면 skip, first match)
  if (!isSubmitted) return
  const score = sub!.adjusted_score ?? sub!.auto_score
  if (score === null) return

  for (const rule of examRules) {
    if ((rule.condition_detail.examSubType as string) === 'not_submitted') continue
    if (checkCondition(rule, 'exam_score', {
      score, maxScore, category: exam.category ?? null,
      examFormat: exam.exam_format ?? 'score', isSubmitted,
    })) {
      logEntries.push(makeEntry(academyId, studentId, rule, `${examDate}T12:00:00.000Z`))
      return
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 학생 1명 재계산 (단일 이벤트 실시간 트리거용)
// 학생이 실제로 속한 반의 데이터만 조회
// ─────────────────────────────────────────────────────────────
export async function recalculateStudent(db: DB, academyId: string, studentId: string) {
  const { data: academy } = await db
    .from('academies')
    .select('lives_enabled, lives_default, lives_auto_from, lives_auto_enabled')
    .eq('id', academyId)
    .single()
  if (!academy?.lives_enabled) return

  const livesDefault = (academy.lives_default ?? 3) as number
  const autoFrom = academy.lives_auto_from as string | null
  const autoEnabled = academy.lives_auto_enabled as boolean

  await db.from('student_lives_log')
    .delete()
    .eq('academy_id', academyId)
    .eq('student_id', studentId)
    .in('source', ['rule', 'init'])

  const logEntries: LogEntry[] = []

  logEntries.push({
    academy_id: academyId, student_id: studentId,
    delta: livesDefault, reason: `기본 목숨 ${livesDefault}개`,
    source: 'init', lives_after: livesDefault,
    created_at: autoFrom ? `${autoFrom}T00:00:00.000Z` : new Date(0).toISOString(),
  })

  if (!autoEnabled || !autoFrom) {
    await flushStudent(db, academyId, studentId, logEntries)
    return
  }

  const { data: rules } = await db
    .from('lives_rules')
    .select('id, condition_type, condition_detail, delta, name')
    .eq('academy_id', academyId)
    .eq('enabled', true)
    .order('order_num')
    .order('created_at')
  if (!rules || rules.length === 0) {
    await flushStudent(db, academyId, studentId, logEntries)
    return
  }

  // 이 학생이 실제로 속한 반만 조회 (핵심 버그 수정)
  const { data: classStudents } = await db.from('class_students').select('class_id').eq('student_id', studentId)
  const classIds = (classStudents ?? []).map((cs: any) => cs.class_id) as string[]
  if (classIds.length === 0) {
    await flushStudent(db, academyId, studentId, logEntries)
    return
  }

  // 출결 — 수업 하나당 첫 번째 매칭 규칙만 적용
  const attRules = rules.filter((r: any) => r.condition_type === 'attendance')
  if (attRules.length > 0) {
    const { data: sessions } = await db.from('sessions').select('id, date').in('class_id', classIds).gte('date', autoFrom)
    if (sessions?.length > 0) {
      const sessDateMap: Record<string, string> = {}
      for (const s of sessions) sessDateMap[s.id] = s.date
      const { data: attRows } = await db.from('attendance')
        .select('status, session_id')
        .in('session_id', sessions.map((s: any) => s.id))
        .eq('student_id', studentId)
      for (const att of attRows ?? []) {
        const date = sessDateMap[att.session_id]
        for (const rule of attRules) {
          if (checkCondition(rule, 'attendance', { status: att.status, date })) {
            logEntries.push(makeEntry(academyId, studentId, rule, `${date}T12:00:00.000Z`))
            break
          }
        }
      }
    }
  }

  // 과제 — 과제 하나당 첫 번째 매칭 규칙만 적용
  const hwRules = rules.filter((r: any) => r.condition_type === 'homework')
  if (hwRules.length > 0) {
    const { data: homeworks } = await db.from('homework').select('id, assigned_date').in('class_id', classIds).gte('assigned_date', autoFrom)
    if (homeworks?.length > 0) {
      const { data: hwRows } = await db.from('homework_status')
        .select('status, homework_id')
        .in('homework_id', homeworks.map((h: any) => h.id))
        .eq('student_id', studentId)
      const hwStatusMap = new Map((hwRows ?? []).map((hs: any) => [hs.homework_id, hs.status]))
      for (const hw of homeworks) {
        const status = hwStatusMap.get(hw.id) ?? 'unrecorded'
        for (const rule of hwRules) {
          if (checkCondition(rule, 'homework', { status })) {
            logEntries.push(makeEntry(academyId, studentId, rule, `${hw.assigned_date}T12:00:00.000Z`))
            break
          }
        }
      }
    }
  }

  // 클리닉 — 클리닉 하나당 첫 번째 매칭 규칙만 적용
  const clinicRules = rules.filter((r: any) => r.condition_type === 'clinic')
  if (clinicRules.length > 0) {
    const { data: clinicSessions } = await db.from('clinic_sessions').select('id, date').in('class_id', classIds).gte('date', autoFrom)
    if (clinicSessions?.length > 0) {
      const csDateMap: Record<string, string> = {}
      for (const s of clinicSessions) csDateMap[s.id] = s.date
      const { data: caRows } = await db.from('clinic_attendance')
        .select('status, clinic_session_id')
        .in('clinic_session_id', clinicSessions.map((s: any) => s.id))
        .eq('student_id', studentId)
      for (const ca of caRows ?? []) {
        const date = csDateMap[ca.clinic_session_id]
        for (const rule of clinicRules) {
          if (checkCondition(rule, 'clinic', { status: ca.status })) {
            logEntries.push(makeEntry(academyId, studentId, rule, `${date}T12:00:00.000Z`))
            break
          }
        }
      }
    }
  }

  // 시험 — 미제출 규칙 우선, 이후 점수 규칙 첫 번째 매칭만 적용
  const examRules = rules.filter((r: any) => r.condition_type === 'exam_score')
  if (examRules.length > 0) {
    const { data: allExams } = await db.from('exams')
      .select('id, category, exam_format, max_score, exam_type, start_at, created_at')
      .in('class_id', classIds)
    const exams = ((allExams ?? []) as any[]).filter(e => {
      const dateStr = e.start_at ? e.start_at.slice(0, 10) : e.created_at.slice(0, 10)
      return dateStr >= autoFrom!
    })
    if (exams.length > 0) {
      const autoExamIds = exams.filter(e => e.exam_type === 'auto').map(e => e.id)
      const maxScoreByExam: Record<string, number> = {}
      if (autoExamIds.length > 0) {
        const { data: qRows } = await db.from('exam_questions').select('exam_id, score').in('exam_id', autoExamIds)
        for (const q of qRows ?? []) maxScoreByExam[q.exam_id] = (maxScoreByExam[q.exam_id] ?? 0) + Number(q.score)
      }
      const examIds = exams.map(e => e.id)
      const { data: subRows } = await db.from('exam_submissions')
        .select('exam_id, auto_score, adjusted_score, is_submitted, is_forfeited')
        .in('exam_id', examIds)
        .eq('student_id', studentId)
      const subByExam = new Map<string, any>((subRows ?? []).map((s: any) => [s.exam_id, s]))

      for (const exam of exams) {
        const maxScore = exam.exam_type === 'manual' ? exam.max_score : (maxScoreByExam[exam.id] ?? null)
        const examDate = exam.start_at ? exam.start_at.slice(0, 10) : exam.created_at.slice(0, 10)
        applyExamRules(examRules, exam, subByExam.get(exam.id), maxScore, academyId, studentId, examDate, logEntries)
      }
    }
  }

  await flushStudent(db, academyId, studentId, logEntries)
}

// 실시간 단건 트리거 → 재계산으로 위임
export async function applyLivesRulesInternal(
  db: DB,
  academyId: string,
  studentId: string,
  _eventType: string,
  _eventDetail: Record<string, unknown>
) {
  await recalculateStudent(db, academyId, studentId)
}

// ─────────────────────────────────────────────────────────────
// 전체 재계산 — 모든 데이터를 한 번에 가져와서 메모리에서 계산
// 각 학생은 본인이 속한 반의 데이터만 사용 (버그 수정)
// ─────────────────────────────────────────────────────────────
export async function recalculate(db: DB, academyId: string) {
  const { data: academy } = await db
    .from('academies')
    .select('lives_enabled, lives_default, lives_auto_from, lives_auto_enabled')
    .eq('id', academyId)
    .single()
  if (!academy?.lives_enabled || !academy?.lives_auto_enabled || !academy?.lives_auto_from) return

  const livesDefault = (academy.lives_default ?? 3) as number
  const autoFrom = academy.lives_auto_from as string

  const [{ data: allStudents }, { data: rules }, { data: classes }] = await Promise.all([
    db.from('students').select('id').eq('academy_id', academyId),
    db.from('lives_rules').select('id, condition_type, condition_detail, delta, name').eq('academy_id', academyId).eq('enabled', true).order('order_num').order('created_at'),
    db.from('classes').select('id').eq('academy_id', academyId),
  ])

  const studentIds = (allStudents ?? []).map((s: any) => s.id) as string[]
  if (studentIds.length === 0 || !rules || rules.length === 0) return

  const classIds = (classes ?? []).map((c: any) => c.id) as string[]

  // 공유 데이터 + 반별 수강생 목록 한 번에 조회
  const [sessionsRes, homeworksRes, clinicSessionsRes, examsRes, classStudentsRes] = await Promise.all([
    classIds.length > 0
      ? db.from('sessions').select('id, date, class_id').in('class_id', classIds).gte('date', autoFrom)
      : Promise.resolve({ data: [] }),
    classIds.length > 0
      ? db.from('homework').select('id, assigned_date, class_id').in('class_id', classIds).gte('assigned_date', autoFrom)
      : Promise.resolve({ data: [] }),
    classIds.length > 0
      ? db.from('clinic_sessions').select('id, date, class_id').in('class_id', classIds).gte('date', autoFrom)
      : Promise.resolve({ data: [] }),
    classIds.length > 0
      ? db.from('exams').select('id, category, exam_format, max_score, exam_type, start_at, created_at, class_id').in('class_id', classIds)
      : Promise.resolve({ data: [] }),
    classIds.length > 0
      ? db.from('class_students').select('student_id, class_id').in('class_id', classIds)
      : Promise.resolve({ data: [] }),
  ])

  // 학생별 소속 반 인덱스
  const classesByStudent = new Map<string, Set<string>>()
  for (const cs of classStudentsRes.data ?? []) {
    if (!classesByStudent.has(cs.student_id)) classesByStudent.set(cs.student_id, new Set())
    classesByStudent.get(cs.student_id)!.add(cs.class_id)
  }

  const sessions = (sessionsRes.data ?? []) as { id: string; date: string; class_id: string }[]
  const sessDateMap: Record<string, string> = {}
  for (const s of sessions) sessDateMap[s.id] = s.date

  const homeworks = (homeworksRes.data ?? []) as { id: string; assigned_date: string; class_id: string }[]

  const clinicSessions = (clinicSessionsRes.data ?? []) as { id: string; date: string; class_id: string }[]
  const csDateMap: Record<string, string> = {}
  for (const s of clinicSessions) csDateMap[s.id] = s.date

  const allExamsRaw = (examsRes.data ?? []) as any[]
  const allExams = allExamsRaw.filter(e => {
    const dateStr = e.start_at ? e.start_at.slice(0, 10) : e.created_at.slice(0, 10)
    return dateStr >= autoFrom
  })

  // 자동채점 시험 만점 계산
  const autoExamIds = allExams.filter(e => e.exam_type === 'auto').map(e => e.id)
  const maxScoreByExam: Record<string, number> = {}
  if (autoExamIds.length > 0) {
    const { data: qRows } = await db.from('exam_questions').select('exam_id, score').in('exam_id', autoExamIds)
    for (const q of qRows ?? []) maxScoreByExam[q.exam_id] = (maxScoreByExam[q.exam_id] ?? 0) + Number(q.score)
  }

  // 전체 학생 데이터 한 번에 조회
  const allSessionIds      = sessions.map(s => s.id)
  const allHomeworkIds     = homeworks.map(h => h.id)
  const allClinicSessionIds = clinicSessions.map(s => s.id)
  const allExamIds         = allExams.map(e => e.id)

  const [attRes, hwStatusRes, clinicAttRes, subRes] = await Promise.all([
    allSessionIds.length > 0
      ? db.from('attendance').select('student_id, session_id, status').in('session_id', allSessionIds)
      : Promise.resolve({ data: [] }),
    allHomeworkIds.length > 0
      ? db.from('homework_status').select('student_id, homework_id, status').in('homework_id', allHomeworkIds)
      : Promise.resolve({ data: [] }),
    allClinicSessionIds.length > 0
      ? db.from('clinic_attendance').select('student_id, clinic_session_id, status').in('clinic_session_id', allClinicSessionIds)
      : Promise.resolve({ data: [] }),
    allExamIds.length > 0
      ? db.from('exam_submissions').select('student_id, exam_id, auto_score, adjusted_score, is_submitted, is_forfeited').in('exam_id', allExamIds)
      : Promise.resolve({ data: [] }),
  ])

  const attByStudent    = groupBy(attRes.data ?? [], 'student_id')
  const hwByStudent     = groupBy(hwStatusRes.data ?? [], 'student_id')
  const caByStudent     = groupBy(clinicAttRes.data ?? [], 'student_id')
  const subByStudent    = groupBy(subRes.data ?? [], 'student_id')

  // 로그 삭제: 학원 전체 한 번에
  await db.from('student_lives_log')
    .delete()
    .eq('academy_id', academyId)
    .in('source', ['rule', 'init'])

  const attRules    = rules.filter((r: any) => r.condition_type === 'attendance')
  const hwRules     = rules.filter((r: any) => r.condition_type === 'homework')
  const clinicRules = rules.filter((r: any) => r.condition_type === 'clinic')
  const examRules   = rules.filter((r: any) => r.condition_type === 'exam_score')

  const allLogEntries: LogEntry[] = []
  const livesUpserts: { academy_id: string; student_id: string; lives: number; updated_at: string }[] = []

  for (const studentId of studentIds) {
    const logEntries: LogEntry[] = []

    logEntries.push({
      academy_id: academyId, student_id: studentId,
      delta: livesDefault, reason: `기본 목숨 ${livesDefault}개`,
      source: 'init', lives_after: livesDefault,
      created_at: `${autoFrom}T00:00:00.000Z`,
    })

    // 이 학생이 속한 반 ID 집합
    const studentClassSet = classesByStudent.get(studentId) ?? new Set<string>()

    // 출결 — 학생 소속 반의 수업만 / 수업 하나당 첫 번째 매칭 규칙만 적용
    if (attRules.length > 0 && studentClassSet.size > 0) {
      for (const att of attByStudent.get(studentId) ?? []) {
        const date = sessDateMap[att.session_id]
        // 이 수업이 학생 소속 반인지 확인
        const session = sessions.find(s => s.id === att.session_id)
        if (!session || !studentClassSet.has(session.class_id)) continue
        for (const rule of attRules) {
          if (checkCondition(rule, 'attendance', { status: att.status })) {
            logEntries.push(makeEntry(academyId, studentId, rule, `${date}T12:00:00.000Z`))
            break
          }
        }
      }
    }

    // 과제 — 학생 소속 반의 과제만 / 과제 하나당 첫 번째 매칭 규칙만 적용
    if (hwRules.length > 0 && studentClassSet.size > 0) {
      const studentHomeworks = homeworks.filter(h => studentClassSet.has(h.class_id))
      const hwStatusMap = new Map((hwByStudent.get(studentId) ?? []).map((hs: any) => [hs.homework_id, hs.status]))
      for (const hw of studentHomeworks) {
        const status = hwStatusMap.get(hw.id) ?? 'unrecorded'
        for (const rule of hwRules) {
          if (checkCondition(rule, 'homework', { status })) {
            logEntries.push(makeEntry(academyId, studentId, rule, `${hw.assigned_date}T12:00:00.000Z`))
            break
          }
        }
      }
    }

    // 클리닉 — 학생 소속 반의 클리닉만 / 클리닉 하나당 첫 번째 매칭 규칙만 적용
    if (clinicRules.length > 0 && studentClassSet.size > 0) {
      for (const ca of caByStudent.get(studentId) ?? []) {
        const date = csDateMap[ca.clinic_session_id]
        const cs = clinicSessions.find(s => s.id === ca.clinic_session_id)
        if (!cs || !studentClassSet.has(cs.class_id)) continue
        for (const rule of clinicRules) {
          if (checkCondition(rule, 'clinic', { status: ca.status })) {
            logEntries.push(makeEntry(academyId, studentId, rule, `${date}T12:00:00.000Z`))
            break
          }
        }
      }
    }

    // 시험 — 학생 소속 반의 시험만 / 미제출 우선, 점수 규칙 첫 번째 매칭만 적용
    if (examRules.length > 0 && studentClassSet.size > 0) {
      const studentExams = allExams.filter(e => studentClassSet.has(e.class_id))
      const subMap = new Map((subByStudent.get(studentId) ?? []).map((s: any) => [s.exam_id, s]))
      for (const exam of studentExams) {
        const maxScore = exam.exam_type === 'manual' ? exam.max_score : (maxScoreByExam[exam.id] ?? null)
        const examDate = exam.start_at ? exam.start_at.slice(0, 10) : exam.created_at.slice(0, 10)
        applyExamRules(examRules, exam, subMap.get(exam.id), maxScore, academyId, studentId, examDate, logEntries)
      }
    }

    // 날짜 순 정렬 + lives_after 재계산
    logEntries.sort((a, b) => a.created_at.localeCompare(b.created_at))
    let acc = 0
    for (const e of logEntries) { acc += e.delta; e.lives_after = acc }

    allLogEntries.push(...logEntries)
    livesUpserts.push({ academy_id: academyId, student_id: studentId, lives: acc, updated_at: new Date().toISOString() })
  }

  // 전체 저장 한 번에
  if (livesUpserts.length > 0)
    await db.from('student_lives').upsert(livesUpserts, { onConflict: 'academy_id,student_id' })
  if (allLogEntries.length > 0)
    await db.from('student_lives_log').insert(allLogEntries)
}

// ─────────────────────────────────────────────────────────────
// 유틸: 배열을 특정 키로 Map 그룹화
// ─────────────────────────────────────────────────────────────
function groupBy<T extends Record<string, any>>(arr: T[], key: string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of arr) {
    const k = item[key]
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(item)
  }
  return map
}
