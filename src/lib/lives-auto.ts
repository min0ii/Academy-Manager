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
  lives_after: number; created_at: string; triggered_at: string; event_key: string
}

function makeEntry(academyId: string, studentId: string, rule: any, created_at: string, triggeredAt: string, eventKey: string): LogEntry {
  return {
    academy_id: academyId, student_id: studentId,
    delta: rule.delta, reason: buildRuleReason(rule),
    source: 'rule', lives_after: 0, created_at,
    triggered_at: triggeredAt, event_key: eventKey,
  }
}

// 한 학생의 lives_after를 DB에 실제로 남아있는 행 기준으로 다시 맞추고 student_lives 갱신
async function repairStudentLives(db: DB, academyId: string, studentId: string) {
  const { data: rows } = await db
    .from('student_lives_log')
    .select('id, delta, created_at, lives_after')
    .eq('academy_id', academyId)
    .eq('student_id', studentId)
  const list = [...(rows ?? [])].sort((a: any, b: any) =>
    (a.created_at as string).localeCompare(b.created_at as string) || (a.id as string).localeCompare(b.id as string))

  let acc = 0
  for (const r of list) {
    acc += r.delta as number
    if (r.lives_after !== acc)
      await db.from('student_lives_log').update({ lives_after: acc }).eq('id', r.id)
  }
  await db.from('student_lives').upsert(
    { academy_id: academyId, student_id: studentId, lives: acc, updated_at: new Date().toISOString() },
    { onConflict: 'academy_id,student_id' }
  )
}

// id 목록을 나눠서 삭제 (한 번에 너무 많이 넘기면 요청이 실패함)
async function deleteLogByIds(db: DB, ids: string[]) {
  for (let i = 0; i < ids.length; i += 200)
    await db.from('student_lives_log').delete().in('id', ids.slice(i, i + 200))
}

// 재계산이 겹쳐서 같은 event_key가 두 번 들어간 행 정리
// 중복이 없으면 조회 한 번으로 끝나고, 있으면 해당 학생만 lives_after 복구
async function dedupeLog(db: DB, academyId: string, studentId?: string) {
  const rows = await fetchAll((f, t) => {
    const q = db.from('student_lives_log')
      .select('id, student_id, event_key')
      .eq('academy_id', academyId)
      .in('source', ['rule', 'init'])
    return (studentId ? q.eq('student_id', studentId) : q).range(f, t)
  })
  rows.sort((a, b) => (a.id as string).localeCompare(b.id as string))

  const seen = new Set<string>()
  const dupIds: string[] = []
  const affected = new Set<string>()
  for (const r of rows) {
    if (!r.event_key) continue
    const key = `${r.student_id}:${r.event_key}`
    if (seen.has(key)) { dupIds.push(r.id); affected.add(r.student_id) }
    else seen.add(key)
  }
  if (dupIds.length === 0) return

  await deleteLogByIds(db, dupIds)
  for (const sid of affected) await repairStudentLives(db, academyId, sid)
}

async function flushStudent(db: DB, academyId: string, studentId: string, logEntries: LogEntry[], triggeredAt: string) {
  // 기존 rule/init 항목 조회 → triggered_at 보존용
  const { data: existing } = await db
    .from('student_lives_log')
    .select('id, event_key, delta, triggered_at, created_at')
    .eq('academy_id', academyId)
    .eq('student_id', studentId)
    .in('source', ['rule', 'init'])
  const existingMap = new Map<string, { delta: number; triggered_at: string }>()
  const existingByDateDelta = new Map<string, string>()
  for (const e of existing ?? []) {
    if (e.event_key) existingMap.set(e.event_key as string, { delta: e.delta as number, triggered_at: e.triggered_at as string })
    if (e.triggered_at) existingByDateDelta.set(`${e.created_at}:${e.delta}`, e.triggered_at as string)
  }

  // manual 항목 조회 — effectiveFrom 이후 것만, 이전 것은 삭제
  const effectiveFrom = logEntries.find(e => e.source === 'init')?.created_at ?? null
  if (effectiveFrom) {
    await db.from('student_lives_log')
      .delete()
      .eq('academy_id', academyId)
      .eq('student_id', studentId)
      .eq('source', 'manual')
      .lt('created_at', effectiveFrom)
  }
  const manualQuery = db
    .from('student_lives_log')
    .select('id, delta, created_at')
    .eq('academy_id', academyId)
    .eq('student_id', studentId)
    .eq('source', 'manual')
  const { data: manualEntries } = effectiveFrom
    ? await manualQuery.gte('created_at', effectiveFrom)
    : await manualQuery

  await db.from('student_lives_log')
    .delete()
    .eq('academy_id', academyId)
    .eq('student_id', studentId)
    .in('source', ['rule', 'init'])

  // triggered_at 보존 처리
  for (const e of logEntries) {
    const prev = existingMap.get(e.event_key)
    if (prev !== undefined) {
      e.triggered_at = prev.delta === e.delta ? prev.triggered_at : triggeredAt
    } else {
      e.triggered_at = existingByDateDelta.get(`${e.created_at}:${e.delta}`) ?? triggeredAt
    }
  }

  // init/rule + manual 전부 날짜순 정렬 후 lives_after 재계산
  type AnyEntry = { id?: string; created_at: string; delta: number; lives_after: number; isManual?: boolean; event_key?: string }
  const allEntries: AnyEntry[] = [
    ...logEntries.map(e => ({ ...e, isManual: false })),
    ...(manualEntries ?? []).map((e: any) => ({ id: e.id, created_at: e.created_at, delta: e.delta, lives_after: 0, isManual: true })),
  ]
  allEntries.sort((a, b) => a.created_at.localeCompare(b.created_at))

  let acc = 0
  const manualUpdates: { id: string; lives_after: number }[] = []
  for (const e of allEntries) {
    acc += e.delta
    e.lives_after = acc
    if (e.isManual && e.id) manualUpdates.push({ id: e.id, lives_after: acc })
  }

  // allEntries에서 계산한 lives_after를 원본 logEntries에 반영
  const ruleAfterMap = new Map<string, number>()
  for (const e of allEntries) {
    if (!e.isManual && e.event_key) ruleAfterMap.set(e.event_key, e.lives_after)
  }
  for (const e of logEntries) {
    const after = ruleAfterMap.get(e.event_key)
    if (after !== undefined) e.lives_after = after
  }

  // manual 항목 lives_after 업데이트
  for (const u of manualUpdates) {
    await db.from('student_lives_log').update({ lives_after: u.lives_after }).eq('id', u.id)
  }

  await db.from('student_lives').upsert(
    { academy_id: academyId, student_id: studentId, lives: acc, updated_at: new Date().toISOString() },
    { onConflict: 'academy_id,student_id' }
  )
  if (logEntries.length > 0) await db.from('student_lives_log').insert(logEntries)

  await dedupeLog(db, academyId, studentId)
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
  logEntries: LogEntry[],
  triggeredAt: string
) {
  const isSubmitted = !!(sub && sub.is_submitted && !sub.is_forfeited)

  // 1) 미제출 규칙 (first match)
  for (const rule of examRules) {
    if ((rule.condition_detail.examSubType as string) !== 'not_submitted') continue
    if (checkCondition(rule, 'exam_score', { isSubmitted, category: exam.category ?? null })) {
      logEntries.push(makeEntry(academyId, studentId, rule, `${examDate}T12:00:00.000Z`, triggeredAt, `exam:${exam.id}`))
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
      logEntries.push(makeEntry(academyId, studentId, rule, `${examDate}T12:00:00.000Z`, triggeredAt, `exam:${exam.id}`))
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
  // 자동화가 꺼져 있으면 기존 기록을 그대로 둔다 (recalculate()와 동일하게 동작)
  if (!academy.lives_auto_enabled || !academy.lives_auto_from) return

  const livesDefault = (academy.lives_default ?? 3) as number
  const autoFrom = academy.lives_auto_from as string
  const triggeredAt = new Date().toISOString()  // 이벤트 트리거 시각

  // 학생 등록일 조회 → effectiveFrom = max(autoFrom, 등록일). 퇴원생은 계산 대상 아님
  const { data: studentRow } = await db.from('students')
    .select('enrolled_at, created_at, status').eq('id', studentId).single()
  if (!studentRow || studentRow.status === 'inactive') return
  const rawDate = (studentRow.enrolled_at ?? studentRow.created_at) as string | null
  const studentDate = rawDate ? rawDate.slice(0, 10) : null
  const effectiveFrom = studentDate && studentDate > autoFrom ? studentDate : autoFrom

  const logEntries: LogEntry[] = []

  logEntries.push({
    academy_id: academyId, student_id: studentId,
    delta: livesDefault, reason: `기본 목숨 ${livesDefault}개`,
    source: 'init', lives_after: livesDefault,
    created_at: `${effectiveFrom}T00:00:00.000Z`,
    triggered_at: triggeredAt, event_key: 'init',
  })

  const { data: rules } = await db
    .from('lives_rules')
    .select('id, condition_type, condition_detail, delta, name')
    .eq('academy_id', academyId)
    .eq('enabled', true)
    .order('order_num')
    .order('created_at')
  if (!rules || rules.length === 0) {
    await flushStudent(db, academyId, studentId, logEntries, triggeredAt)
    return
  }

  // 이 학생이 실제로 속한 반만 조회 (핵심 버그 수정)
  const { data: classStudents } = await db.from('class_students').select('class_id').eq('student_id', studentId)
  const classIds = (classStudents ?? []).map((cs: any) => cs.class_id) as string[]
  if (classIds.length === 0) {
    await flushStudent(db, academyId, studentId, logEntries, triggeredAt)
    return
  }

  // 출결 — 수업 하나당 첫 번째 매칭 규칙만 적용
  const attRules = rules.filter((r: any) => r.condition_type === 'attendance')
  if (attRules.length > 0) {
    const { data: sessions } = await db.from('sessions').select('id, date').in('class_id', classIds).gte('date', effectiveFrom)
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
            logEntries.push(makeEntry(academyId, studentId, rule, `${date}T12:00:00.000Z`, triggeredAt, `att:${att.session_id}`))
            break
          }
        }
      }
    }
  }

  // 과제 — 과제 하나당 첫 번째 매칭 규칙만 적용
  const hwRules = rules.filter((r: any) => r.condition_type === 'homework')
  if (hwRules.length > 0) {
    const { data: homeworks } = await db.from('homework').select('id, assigned_date').in('class_id', classIds).gte('assigned_date', effectiveFrom)
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
            logEntries.push(makeEntry(academyId, studentId, rule, `${hw.assigned_date}T12:00:00.000Z`, triggeredAt, `hw:${hw.id}`))
            break
          }
        }
      }
    }
  }

  // 클리닉 — 클리닉 하나당 첫 번째 매칭 규칙만 적용
  const clinicRules = rules.filter((r: any) => r.condition_type === 'clinic')
  if (clinicRules.length > 0) {
    const { data: clinicSessions } = await db.from('clinic_sessions').select('id, date').in('class_id', classIds).gte('date', effectiveFrom)
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
            logEntries.push(makeEntry(academyId, studentId, rule, `${date}T12:00:00.000Z`, triggeredAt, `clinic:${ca.clinic_session_id}`))
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
      return dateStr >= effectiveFrom!
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
        applyExamRules(examRules, exam, subByExam.get(exam.id), maxScore, academyId, studentId, examDate, logEntries, triggeredAt)
      }
    }
  }

  await flushStudent(db, academyId, studentId, logEntries, triggeredAt)
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
  const triggeredAt = new Date().toISOString()  // 이벤트 트리거 시각

  const [{ data: allStudents }, { data: rules }, { data: classes }] = await Promise.all([
    db.from('students').select('id, enrolled_at, created_at').eq('academy_id', academyId).eq('status', 'active'),
    db.from('lives_rules').select('id, condition_type, condition_detail, delta, name').eq('academy_id', academyId).eq('enabled', true).order('order_num').order('created_at'),
    db.from('classes').select('id').eq('academy_id', academyId),
  ])

  const studentIds = (allStudents ?? []).map((s: any) => s.id) as string[]
  if (studentIds.length === 0 || !rules || rules.length === 0) return

  // 학생별 effectiveFrom = max(autoFrom, 학생 등록일)
  const effectiveFromByStudent = new Map<string, string>()
  for (const s of allStudents ?? []) {
    const rawDate = (s.enrolled_at ?? s.created_at) as string | null
    const studentDate = rawDate ? rawDate.slice(0, 10) : null
    effectiveFromByStudent.set(s.id, studentDate && studentDate > autoFrom ? studentDate : autoFrom)
  }

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
  const sessClassMap: Record<string, string> = {}
  for (const s of sessions) { sessDateMap[s.id] = s.date; sessClassMap[s.id] = s.class_id }

  const homeworks = (homeworksRes.data ?? []) as { id: string; assigned_date: string; class_id: string }[]

  const clinicSessions = (clinicSessionsRes.data ?? []) as { id: string; date: string; class_id: string }[]
  const csDateMap: Record<string, string> = {}
  const csClassMap: Record<string, string> = {}
  for (const s of clinicSessions) { csDateMap[s.id] = s.date; csClassMap[s.id] = s.class_id }

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

  // Supabase 1000행 기본 제한 우회 — fetchAll로 전체 데이터 페이지네이션 조회
  const [attData, hwData, caData, subData] = await Promise.all([
    allSessionIds.length > 0
      ? fetchAll((f, t) => db.from('attendance').select('student_id, session_id, status').in('session_id', allSessionIds).range(f, t))
      : Promise.resolve([]),
    allHomeworkIds.length > 0
      ? fetchAll((f, t) => db.from('homework_status').select('student_id, homework_id, status').in('homework_id', allHomeworkIds).range(f, t))
      : Promise.resolve([]),
    allClinicSessionIds.length > 0
      ? fetchAll((f, t) => db.from('clinic_attendance').select('student_id, clinic_session_id, status').in('clinic_session_id', allClinicSessionIds).range(f, t))
      : Promise.resolve([]),
    allExamIds.length > 0
      ? fetchAll((f, t) => db.from('exam_submissions').select('student_id, exam_id, auto_score, adjusted_score, is_submitted, is_forfeited').in('exam_id', allExamIds).range(f, t))
      : Promise.resolve([]),
  ])

  const attByStudent    = groupBy(attData, 'student_id')
  const hwByStudent     = groupBy(hwData, 'student_id')
  const caByStudent     = groupBy(caData, 'student_id')
  const subByStudent    = groupBy(subData, 'student_id')

  // 삭제 전 기존 로그 조회 → event_key + delta 동일하면 triggered_at 유지
  const [existingLogs, manualLogs] = await Promise.all([
    fetchAll((f, t) =>
      db.from('student_lives_log')
        .select('student_id, event_key, delta, triggered_at, created_at')
        .eq('academy_id', academyId)
        .in('source', ['rule', 'init'])
        .range(f, t)
    ),
    fetchAll((f, t) =>
      db.from('student_lives_log')
        .select('id, student_id, delta, created_at')
        .eq('academy_id', academyId)
        .eq('source', 'manual')
        .gte('created_at', `${autoFrom}T00:00:00.000Z`)
        .range(f, t)
    ),
  ])

  // Map<studentId, Map<event_key, {delta, triggered_at}>> — 신규 데이터용
  const existingByStudent = new Map<string, Map<string, { delta: number; triggered_at: string }>>()
  // Map<studentId, Map<created_at:delta, triggered_at>> — event_key 없는 기존 데이터용
  const existingDateDeltaByStudent = new Map<string, Map<string, string>>()
  for (const e of existingLogs) {
    if (!existingByStudent.has(e.student_id)) existingByStudent.set(e.student_id, new Map())
    if (!existingDateDeltaByStudent.has(e.student_id)) existingDateDeltaByStudent.set(e.student_id, new Map())
    if (e.event_key) existingByStudent.get(e.student_id)!.set(e.event_key, { delta: e.delta, triggered_at: e.triggered_at })
    if (e.triggered_at) existingDateDeltaByStudent.get(e.student_id)!.set(`${e.created_at}:${e.delta}`, e.triggered_at)
  }

  // manual 항목 학생별 인덱스 — 학생별 기준일 이전 것은 계산에서 빼고 삭제 대상으로 모음
  const staleManualIds: string[] = []
  const liveManualLogs = manualLogs.filter(m => {
    const from = effectiveFromByStudent.get(m.student_id) ?? autoFrom
    if ((m.created_at as string) < `${from}T00:00:00.000Z`) { staleManualIds.push(m.id); return false }
    return true
  })
  const manualByStudent = groupBy(liveManualLogs, 'student_id')

  // 로그 삭제: 재계산 대상 학생만 (퇴원생 기록은 보존)
  for (let i = 0; i < studentIds.length; i += 200)
    await db.from('student_lives_log')
      .delete()
      .eq('academy_id', academyId)
      .in('source', ['rule', 'init'])
      .in('student_id', studentIds.slice(i, i + 200))

  // 기준일 이전 manual 항목 삭제 — 학원 공통 기준일 + 학생별 등록일 기준 둘 다
  await db.from('student_lives_log')
    .delete()
    .eq('academy_id', academyId)
    .eq('source', 'manual')
    .lt('created_at', `${autoFrom}T00:00:00.000Z`)
  await deleteLogByIds(db, staleManualIds)

  const attRules    = rules.filter((r: any) => r.condition_type === 'attendance')
  const hwRules     = rules.filter((r: any) => r.condition_type === 'homework')
  const clinicRules = rules.filter((r: any) => r.condition_type === 'clinic')
  const examRules   = rules.filter((r: any) => r.condition_type === 'exam_score')

  const allLogEntries: LogEntry[] = []
  const allManualUpdates: { id: string; lives_after: number }[] = []
  const livesUpserts: { academy_id: string; student_id: string; lives: number; updated_at: string }[] = []

  for (const studentId of studentIds) {
    const logEntries: LogEntry[] = []
    const effectiveFrom = effectiveFromByStudent.get(studentId) ?? autoFrom

    logEntries.push({
      academy_id: academyId, student_id: studentId,
      delta: livesDefault, reason: `기본 목숨 ${livesDefault}개`,
      source: 'init', lives_after: livesDefault,
      created_at: `${effectiveFrom}T00:00:00.000Z`,
      triggered_at: triggeredAt, event_key: 'init',
    })

    // 이 학생이 속한 반 ID 집합
    const studentClassSet = classesByStudent.get(studentId) ?? new Set<string>()

    // 출결 — 학생 소속 반의 수업만 / 등록일 이후만 / 수업 하나당 첫 번째 매칭 규칙만 적용
    if (attRules.length > 0 && studentClassSet.size > 0) {
      for (const att of attByStudent.get(studentId) ?? []) {
        const date = sessDateMap[att.session_id]
        if (!date || date < effectiveFrom) continue  // 등록 전 수업 무시
        const sessClassId = sessClassMap[att.session_id]
        if (!sessClassId || !studentClassSet.has(sessClassId)) continue
        for (const rule of attRules) {
          if (checkCondition(rule, 'attendance', { status: att.status })) {
            logEntries.push(makeEntry(academyId, studentId, rule, `${date}T12:00:00.000Z`, triggeredAt, `att:${att.session_id}`))
            break
          }
        }
      }
    }

    // 과제 — 학생 소속 반의 과제만 / 등록일 이후만 / 과제 하나당 첫 번째 매칭 규칙만 적용
    if (hwRules.length > 0 && studentClassSet.size > 0) {
      const studentHomeworks = homeworks.filter(h => studentClassSet.has(h.class_id) && h.assigned_date >= effectiveFrom)
      const hwStatusMap = new Map((hwByStudent.get(studentId) ?? []).map((hs: any) => [hs.homework_id, hs.status]))
      for (const hw of studentHomeworks) {
        const status = hwStatusMap.get(hw.id) ?? 'unrecorded'
        for (const rule of hwRules) {
          if (checkCondition(rule, 'homework', { status })) {
            logEntries.push(makeEntry(academyId, studentId, rule, `${hw.assigned_date}T12:00:00.000Z`, triggeredAt, `hw:${hw.id}`))
            break
          }
        }
      }
    }

    // 클리닉 — 학생 소속 반의 클리닉만 / 등록일 이후만 / 클리닉 하나당 첫 번째 매칭 규칙만 적용
    if (clinicRules.length > 0 && studentClassSet.size > 0) {
      for (const ca of caByStudent.get(studentId) ?? []) {
        const date = csDateMap[ca.clinic_session_id]
        if (!date || date < effectiveFrom) continue  // 등록 전 클리닉 무시
        const csClassId = csClassMap[ca.clinic_session_id]
        if (!csClassId || !studentClassSet.has(csClassId)) continue
        for (const rule of clinicRules) {
          if (checkCondition(rule, 'clinic', { status: ca.status })) {
            logEntries.push(makeEntry(academyId, studentId, rule, `${date}T12:00:00.000Z`, triggeredAt, `clinic:${ca.clinic_session_id}`))
            break
          }
        }
      }
    }

    // 시험 — 학생 소속 반의 시험만 / 등록일 이후만 / 미제출 우선, 점수 규칙 첫 번째 매칭만 적용
    if (examRules.length > 0 && studentClassSet.size > 0) {
      const studentExams = allExams.filter(e => {
        const examDate = e.start_at ? e.start_at.slice(0, 10) : e.created_at.slice(0, 10)
        return studentClassSet.has(e.class_id) && examDate >= effectiveFrom
      })
      const subMap = new Map((subByStudent.get(studentId) ?? []).map((s: any) => [s.exam_id, s]))
      for (const exam of studentExams) {
        const maxScore = exam.exam_type === 'manual' ? exam.max_score : (maxScoreByExam[exam.id] ?? null)
        const examDate = exam.start_at ? exam.start_at.slice(0, 10) : exam.created_at.slice(0, 10)
        applyExamRules(examRules, exam, subMap.get(exam.id), maxScore, academyId, studentId, examDate, logEntries, triggeredAt)
      }
    }

    // triggered_at 보존 처리
    const studentExistingMap = existingByStudent.get(studentId)
    const studentDateDeltaMap = existingDateDeltaByStudent.get(studentId)
    for (const e of logEntries) {
      const prev = studentExistingMap?.get(e.event_key)
      if (prev !== undefined) {
        e.triggered_at = prev.delta === e.delta ? prev.triggered_at : triggeredAt
      } else {
        e.triggered_at = studentDateDeltaMap?.get(`${e.created_at}:${e.delta}`) ?? triggeredAt
      }
    }

    // init/rule + manual 전부 날짜순 정렬 후 lives_after 재계산
    type AnyEntry = { id?: string; created_at: string; delta: number; lives_after: number; isManual?: boolean; event_key?: string }
    const allEntries: AnyEntry[] = [
      ...logEntries.map(e => ({ ...e, isManual: false })),
      ...(manualByStudent.get(studentId) ?? []).map((e: any) => ({ id: e.id, created_at: e.created_at, delta: e.delta, lives_after: 0, isManual: true })),
    ]
    allEntries.sort((a, b) => a.created_at.localeCompare(b.created_at))

    let acc = 0
    const manualUpdates: { id: string; lives_after: number }[] = []
    for (const e of allEntries) {
      acc += e.delta
      e.lives_after = acc
      if (e.isManual && e.id) manualUpdates.push({ id: e.id, lives_after: acc })
    }
    // allEntries에서 계산한 lives_after를 원본 logEntries에 반영 (event_key로 정확히 매칭)
    const ruleAfterMap = new Map<string, number>()
    for (const e of allEntries) {
      if (!e.isManual && e.event_key) ruleAfterMap.set(e.event_key, e.lives_after)
    }
    for (const e of logEntries) {
      const after = ruleAfterMap.get(e.event_key)
      if (after !== undefined) e.lives_after = after
    }

    allManualUpdates.push(...manualUpdates)
    allLogEntries.push(...logEntries)
    livesUpserts.push({ academy_id: academyId, student_id: studentId, lives: acc, updated_at: new Date().toISOString() })
  }

  // 전체 저장 한 번에
  if (livesUpserts.length > 0)
    await db.from('student_lives').upsert(livesUpserts, { onConflict: 'academy_id,student_id' })
  if (allLogEntries.length > 0)
    await db.from('student_lives_log').insert(allLogEntries)

  // manual 항목 lives_after 반영
  for (const u of allManualUpdates)
    await db.from('student_lives_log').update({ lives_after: u.lives_after }).eq('id', u.id)

  await dedupeLog(db, academyId)
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

// ─────────────────────────────────────────────────────────────
// 유틸: Supabase 1000행 기본 제한 우회 — 전체 데이터 페이지네이션 조회
// ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(
  buildQuery: (from: number, to: number) => Promise<{ data: any[] | null }>
): Promise<any[]> {
  const all: any[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data } = await buildQuery(from, from + PAGE - 1)
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}
