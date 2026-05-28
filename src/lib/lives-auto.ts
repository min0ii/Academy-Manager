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
// 학생 1명 재계산 + 로그 재구성 (단독 호출용 — 공유 데이터 직접 조회)
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

  const logEntries: { academy_id: string; student_id: string; delta: number; reason: string; source: string; lives_after: number; created_at: string }[] = []
  let running = livesDefault

  logEntries.push({
    academy_id: academyId, student_id: studentId,
    delta: livesDefault, reason: `기본 목숨 ${livesDefault}개`,
    source: 'init', lives_after: livesDefault,
    created_at: autoFrom ? `${autoFrom}T00:00:00.000Z` : new Date(0).toISOString(),
  })

  if (!autoEnabled || !autoFrom) {
    await db.from('student_lives').upsert(
      { academy_id: academyId, student_id: studentId, lives: running, updated_at: new Date().toISOString() },
      { onConflict: 'academy_id,student_id' }
    )
    await db.from('student_lives_log').insert(logEntries)
    return
  }

  const { data: rules } = await db
    .from('lives_rules')
    .select('id, condition_type, condition_detail, delta, name')
    .eq('academy_id', academyId)
    .eq('enabled', true)
  if (!rules || rules.length === 0) {
    await db.from('student_lives').upsert(
      { academy_id: academyId, student_id: studentId, lives: running, updated_at: new Date().toISOString() },
      { onConflict: 'academy_id,student_id' }
    )
    await db.from('student_lives_log').insert(logEntries)
    return
  }

  const { data: classes } = await db.from('classes').select('id').eq('academy_id', academyId)
  const classIds = (classes ?? []).map((c: any) => c.id) as string[]

  const attRules = rules.filter((r: any) => r.condition_type === 'attendance')
  if (attRules.length > 0 && classIds.length > 0) {
    const { data: sessions } = await db.from('sessions').select('id, date').in('class_id', classIds).gte('date', autoFrom)
    if (sessions && sessions.length > 0) {
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
            running += rule.delta
            logEntries.push({
              academy_id: academyId, student_id: studentId,
              delta: rule.delta, reason: buildRuleReason(rule),
              source: 'rule', lives_after: running,
              created_at: `${date}T12:00:00.000Z`,
            })
          }
        }
      }
    }
  }

  const hwRules = rules.filter((r: any) => r.condition_type === 'homework')
  if (hwRules.length > 0 && classIds.length > 0) {
    const { data: homeworks } = await db.from('homework').select('id, assigned_date').in('class_id', classIds).gte('assigned_date', autoFrom)
    if (homeworks && homeworks.length > 0) {
      const hwDateMap: Record<string, string> = {}
      for (const h of homeworks) hwDateMap[h.id] = h.assigned_date
      const { data: hwRows } = await db.from('homework_status')
        .select('status, homework_id')
        .in('homework_id', homeworks.map((h: any) => h.id))
        .eq('student_id', studentId)
      const hwStatusMap = new Map((hwRows ?? []).map((hs: any) => [hs.homework_id, hs.status]))
      for (const hw of homeworks) {
        const status = hwStatusMap.get(hw.id) ?? 'unrecorded'
        const date = hwDateMap[hw.id]
        for (const rule of hwRules) {
          if (checkCondition(rule, 'homework', { status, date })) {
            running += rule.delta
            logEntries.push({
              academy_id: academyId, student_id: studentId,
              delta: rule.delta, reason: buildRuleReason(rule),
              source: 'rule', lives_after: running,
              created_at: `${date}T12:00:00.000Z`,
            })
          }
        }
      }
    }
  }

  const clinicRules = rules.filter((r: any) => r.condition_type === 'clinic')
  if (clinicRules.length > 0 && classIds.length > 0) {
    const { data: clinicSessions } = await db.from('clinic_sessions').select('id, date').in('class_id', classIds).gte('date', autoFrom)
    if (clinicSessions && clinicSessions.length > 0) {
      const csDateMap: Record<string, string> = {}
      for (const s of clinicSessions) csDateMap[s.id] = s.date
      const { data: caRows } = await db.from('clinic_attendance')
        .select('status, clinic_session_id')
        .in('clinic_session_id', clinicSessions.map((s: any) => s.id))
        .eq('student_id', studentId)
      for (const ca of caRows ?? []) {
        const date = csDateMap[ca.clinic_session_id]
        for (const rule of clinicRules) {
          if (checkCondition(rule, 'clinic', { status: ca.status, date })) {
            running += rule.delta
            logEntries.push({
              academy_id: academyId, student_id: studentId,
              delta: rule.delta, reason: buildRuleReason(rule),
              source: 'rule', lives_after: running,
              created_at: `${date}T12:00:00.000Z`,
            })
          }
        }
      }
    }
  }

  const examRules = rules.filter((r: any) => r.condition_type === 'exam_score')
  if (examRules.length > 0 && classIds.length > 0) {
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
      for (const exam of exams) {
        const maxScore = exam.exam_type === 'manual' ? exam.max_score : (maxScoreByExam[exam.id] ?? null)
        const examDate = exam.start_at ? exam.start_at.slice(0, 10) : exam.created_at.slice(0, 10)
        const { data: sub } = await db.from('exam_submissions')
          .select('auto_score, adjusted_score, is_submitted, is_forfeited')
          .eq('exam_id', exam.id)
          .eq('student_id', studentId)
          .maybeSingle()
        const isSubmitted = !!(sub && sub.is_submitted && !sub.is_forfeited)
        for (const rule of examRules) {
          const ruleSubType = (rule.condition_detail.examSubType as string) ?? 'score'
          if (ruleSubType === 'not_submitted') {
            if (checkCondition(rule, 'exam_score', {
              isSubmitted,
              category: exam.category ?? null,
            })) {
              running += rule.delta
              logEntries.push({
                academy_id: academyId, student_id: studentId,
                delta: rule.delta, reason: buildRuleReason(rule),
                source: 'rule', lives_after: running,
                created_at: `${examDate}T12:00:00.000Z`,
              })
            }
          } else {
            if (!isSubmitted) continue
            const score = sub!.adjusted_score ?? sub!.auto_score
            if (score === null) continue
            if (checkCondition(rule, 'exam_score', {
              score, maxScore, date: examDate,
              category: exam.category ?? null,
              examFormat: exam.exam_format ?? 'score',
              isSubmitted,
            })) {
              running += rule.delta
              logEntries.push({
                academy_id: academyId, student_id: studentId,
                delta: rule.delta, reason: buildRuleReason(rule),
                source: 'rule', lives_after: running,
                created_at: `${examDate}T12:00:00.000Z`,
              })
            }
          }
        }
      }
    }
  }

  logEntries.sort((a, b) => a.created_at.localeCompare(b.created_at))
  let acc = 0
  for (const e of logEntries) {
    acc += e.delta
    e.lives_after = acc
  }
  running = acc

  await db.from('student_lives').upsert(
    { academy_id: academyId, student_id: studentId, lives: running, updated_at: new Date().toISOString() },
    { onConflict: 'academy_id,student_id' }
  )
  if (logEntries.length > 0) await db.from('student_lives_log').insert(logEntries)
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
// 공유 데이터 타입
// ─────────────────────────────────────────────────────────────
type SharedData = {
  livesDefault: number
  autoFrom: string
  rules: any[]
  classIds: string[]
  // 출결
  sessDateMap: Record<string, string>           // session_id → date
  sessionIds: string[]
  // 과제
  homeworks: { id: string; assigned_date: string }[]
  hwDateMap: Record<string, string>             // homework_id → date
  // 클리닉
  csDateMap: Record<string, string>             // clinic_session_id → date
  clinicSessionIds: string[]
  // 시험
  exams: any[]
  maxScoreByExam: Record<string, number>
}

// ─────────────────────────────────────────────────────────────
// 학생 1명 — 공유 데이터를 받아서 본인 데이터만 조회 (병렬 전용)
// ─────────────────────────────────────────────────────────────
async function recalculateStudentFast(
  db: DB,
  academyId: string,
  studentId: string,
  shared: SharedData
) {
  const { livesDefault, autoFrom, rules, sessDateMap, sessionIds,
          homeworks, hwDateMap, csDateMap, clinicSessionIds,
          exams, maxScoreByExam } = shared

  // 이전 rule/init 로그 삭제
  await db.from('student_lives_log')
    .delete()
    .eq('academy_id', academyId)
    .eq('student_id', studentId)
    .in('source', ['rule', 'init'])

  const logEntries: { academy_id: string; student_id: string; delta: number; reason: string; source: string; lives_after: number; created_at: string }[] = []

  // init 로그
  logEntries.push({
    academy_id: academyId, student_id: studentId,
    delta: livesDefault, reason: `기본 목숨 ${livesDefault}개`,
    source: 'init', lives_after: livesDefault,
    created_at: `${autoFrom}T00:00:00.000Z`,
  })

  // 출결
  const attRules = rules.filter((r: any) => r.condition_type === 'attendance')
  if (attRules.length > 0 && sessionIds.length > 0) {
    const { data: attRows } = await db.from('attendance')
      .select('status, session_id')
      .in('session_id', sessionIds)
      .eq('student_id', studentId)
    for (const att of attRows ?? []) {
      const date = sessDateMap[att.session_id]
      for (const rule of attRules) {
        if (checkCondition(rule, 'attendance', { status: att.status, date })) {
          logEntries.push({
            academy_id: academyId, student_id: studentId,
            delta: rule.delta, reason: buildRuleReason(rule),
            source: 'rule', lives_after: 0,
            created_at: `${date}T12:00:00.000Z`,
          })
        }
      }
    }
  }

  // 과제
  const hwRules = rules.filter((r: any) => r.condition_type === 'homework')
  if (hwRules.length > 0 && homeworks.length > 0) {
    const hwIds = homeworks.map(h => h.id)
    const { data: hwRows } = await db.from('homework_status')
      .select('status, homework_id')
      .in('homework_id', hwIds)
      .eq('student_id', studentId)
    const hwStatusMap = new Map((hwRows ?? []).map((hs: any) => [hs.homework_id, hs.status]))
    for (const hw of homeworks) {
      const status = hwStatusMap.get(hw.id) ?? 'unrecorded'
      const date = hwDateMap[hw.id]
      for (const rule of hwRules) {
        if (checkCondition(rule, 'homework', { status, date })) {
          logEntries.push({
            academy_id: academyId, student_id: studentId,
            delta: rule.delta, reason: buildRuleReason(rule),
            source: 'rule', lives_after: 0,
            created_at: `${date}T12:00:00.000Z`,
          })
        }
      }
    }
  }

  // 클리닉
  const clinicRules = rules.filter((r: any) => r.condition_type === 'clinic')
  if (clinicRules.length > 0 && clinicSessionIds.length > 0) {
    const { data: caRows } = await db.from('clinic_attendance')
      .select('status, clinic_session_id')
      .in('clinic_session_id', clinicSessionIds)
      .eq('student_id', studentId)
    for (const ca of caRows ?? []) {
      const date = csDateMap[ca.clinic_session_id]
      for (const rule of clinicRules) {
        if (checkCondition(rule, 'clinic', { status: ca.status, date })) {
          logEntries.push({
            academy_id: academyId, student_id: studentId,
            delta: rule.delta, reason: buildRuleReason(rule),
            source: 'rule', lives_after: 0,
            created_at: `${date}T12:00:00.000Z`,
          })
        }
      }
    }
  }

  // 시험
  const examRules = rules.filter((r: any) => r.condition_type === 'exam_score')
  if (examRules.length > 0 && exams.length > 0) {
    for (const exam of exams) {
      const maxScore = exam.exam_type === 'manual' ? exam.max_score : (maxScoreByExam[exam.id] ?? null)
      const examDate = exam.start_at ? exam.start_at.slice(0, 10) : exam.created_at.slice(0, 10)
      const { data: sub } = await db.from('exam_submissions')
        .select('auto_score, adjusted_score, is_submitted, is_forfeited')
        .eq('exam_id', exam.id)
        .eq('student_id', studentId)
        .maybeSingle()
      const isSubmitted = !!(sub && sub.is_submitted && !sub.is_forfeited)
      for (const rule of examRules) {
        const ruleSubType = (rule.condition_detail.examSubType as string) ?? 'score'
        if (ruleSubType === 'not_submitted') {
          if (checkCondition(rule, 'exam_score', {
            isSubmitted,
            category: exam.category ?? null,
          })) {
            logEntries.push({
              academy_id: academyId, student_id: studentId,
              delta: rule.delta, reason: buildRuleReason(rule),
              source: 'rule', lives_after: 0,
              created_at: `${examDate}T12:00:00.000Z`,
            })
          }
        } else {
          if (!isSubmitted) continue
          const score = sub!.adjusted_score ?? sub!.auto_score
          if (score === null) continue
          if (checkCondition(rule, 'exam_score', {
            score, maxScore, date: examDate,
            category: exam.category ?? null,
            examFormat: exam.exam_format ?? 'score',
            isSubmitted,
          })) {
            logEntries.push({
              academy_id: academyId, student_id: studentId,
              delta: rule.delta, reason: buildRuleReason(rule),
              source: 'rule', lives_after: 0,
              created_at: `${examDate}T12:00:00.000Z`,
            })
          }
        }
      }
    }
  }

  // 날짜 순 정렬 + lives_after 재계산
  logEntries.sort((a, b) => a.created_at.localeCompare(b.created_at))
  let acc = 0
  for (const e of logEntries) {
    acc += e.delta
    e.lives_after = acc
  }

  await db.from('student_lives').upsert(
    { academy_id: academyId, student_id: studentId, lives: acc, updated_at: new Date().toISOString() },
    { onConflict: 'academy_id,student_id' }
  )
  if (logEntries.length > 0) await db.from('student_lives_log').insert(logEntries)
}

// ─────────────────────────────────────────────────────────────
// 전체 재계산 — 공유 데이터 한 번 조회 후 학생 전체 병렬 처리
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
    db.from('lives_rules').select('id, condition_type, condition_detail, delta, name').eq('academy_id', academyId).eq('enabled', true),
    db.from('classes').select('id').eq('academy_id', academyId),
  ])

  const studentIds = (allStudents ?? []).map((s: any) => s.id) as string[]
  if (studentIds.length === 0) return
  if (!rules || rules.length === 0) return

  const classIds = (classes ?? []).map((c: any) => c.id) as string[]

  // 공유 데이터 병렬 조회
  const [sessionsResult, homeworksResult, clinicSessionsResult, examsResult] = await Promise.all([
    classIds.length > 0
      ? db.from('sessions').select('id, date').in('class_id', classIds).gte('date', autoFrom)
      : Promise.resolve({ data: [] }),
    classIds.length > 0
      ? db.from('homework').select('id, assigned_date').in('class_id', classIds).gte('assigned_date', autoFrom)
      : Promise.resolve({ data: [] }),
    classIds.length > 0
      ? db.from('clinic_sessions').select('id, date').in('class_id', classIds).gte('date', autoFrom)
      : Promise.resolve({ data: [] }),
    classIds.length > 0
      ? db.from('exams').select('id, category, exam_format, max_score, exam_type, start_at, created_at').in('class_id', classIds)
      : Promise.resolve({ data: [] }),
  ])

  const sessions = (sessionsResult.data ?? []) as { id: string; date: string }[]
  const sessDateMap: Record<string, string> = {}
  for (const s of sessions) sessDateMap[s.id] = s.date
  const sessionIds = sessions.map(s => s.id)

  const homeworks = (homeworksResult.data ?? []) as { id: string; assigned_date: string }[]
  const hwDateMap: Record<string, string> = {}
  for (const h of homeworks) hwDateMap[h.id] = h.assigned_date

  const clinicSessions = (clinicSessionsResult.data ?? []) as { id: string; date: string }[]
  const csDateMap: Record<string, string> = {}
  for (const s of clinicSessions) csDateMap[s.id] = s.date
  const clinicSessionIds = clinicSessions.map(s => s.id)

  const allExams = ((examsResult.data ?? []) as any[]).filter(e => {
    const dateStr = e.start_at ? e.start_at.slice(0, 10) : e.created_at.slice(0, 10)
    return dateStr >= autoFrom
  })
  const autoExamIds = allExams.filter(e => e.exam_type === 'auto').map(e => e.id)
  const maxScoreByExam: Record<string, number> = {}
  if (autoExamIds.length > 0) {
    const { data: qRows } = await db.from('exam_questions').select('exam_id, score').in('exam_id', autoExamIds)
    for (const q of qRows ?? []) maxScoreByExam[q.exam_id] = (maxScoreByExam[q.exam_id] ?? 0) + Number(q.score)
  }

  const shared: SharedData = {
    livesDefault, autoFrom, rules, classIds,
    sessDateMap, sessionIds,
    homeworks, hwDateMap,
    csDateMap, clinicSessionIds,
    exams: allExams, maxScoreByExam,
  }

  // 모든 학생 병렬 처리
  await Promise.all(
    studentIds.map(studentId => recalculateStudentFast(db, academyId, studentId, shared))
  )
}
