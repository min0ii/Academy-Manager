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
    // 신규: statuses 배열 / 구버전 호환: status 단일값
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

    if (examSubType === 'pass_fail') {
      if (eventDetail.examFormat !== 'pass_fail') return false
      const score = eventDetail.score as number
      return d.result === 'pass' ? score === 1 : score === 0
    }

    // score 유형 (구버전 호환: examSubType 없으면 score로 처리)
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

export async function applyLivesRulesInternal(
  db: DB,
  academyId: string,
  studentId: string,
  eventType: string,
  eventDetail: Record<string, unknown>
) {
  const { data: academy } = await (db as any)
    .from('academies')
    .select('lives_enabled, lives_auto_enabled, lives_auto_from, lives_default')
    .eq('id', academyId)
    .single()
  if (!academy?.lives_enabled || !academy?.lives_auto_enabled) return

  const autoFrom = academy.lives_auto_from as string | null
  const eventDate = eventDetail.date as string | null
  if (autoFrom && eventDate && eventDate < autoFrom) return

  const { data: rules } = await (db as any)
    .from('lives_rules')
    .select('condition_type, condition_detail, delta')
    .eq('academy_id', academyId)
    .eq('condition_type', eventType)
    .eq('enabled', true)

  let totalDelta = 0
  for (const rule of rules ?? []) {
    if (checkCondition(rule as LivesRule, eventType, eventDetail)) {
      totalDelta += rule.delta
    }
  }
  if (totalDelta === 0) return

  const { data: current } = await (db as any)
    .from('student_lives')
    .select('lives')
    .eq('academy_id', academyId)
    .eq('student_id', studentId)
    .maybeSingle()
  const currentLives = current?.lives ?? (academy.lives_default ?? 3)
  await (db as any).from('student_lives').upsert(
    {
      academy_id: academyId,
      student_id: studentId,
      lives: currentLives + totalDelta,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'academy_id,student_id' }
  )
}

export async function recalculate(db: DB, academyId: string) {
  const { data: academy } = await (db as any)
    .from('academies')
    .select('lives_enabled, lives_default, lives_auto_from, lives_auto_enabled')
    .eq('id', academyId)
    .single()
  if (!academy?.lives_enabled || !academy?.lives_auto_enabled || !academy?.lives_auto_from) return

  const autoFrom = academy.lives_auto_from as string
  const livesDefault = (academy.lives_default ?? 3) as number

  const { data: allStudents } = await (db as any)
    .from('students')
    .select('id')
    .eq('academy_id', academyId)
  const studentIds = (allStudents ?? []).map((s: any) => s.id) as string[]
  if (studentIds.length === 0) return

  const { data: rules } = await (db as any)
    .from('lives_rules')
    .select('id, condition_type, condition_detail, delta')
    .eq('academy_id', academyId)
    .eq('enabled', true)

  const deltaMap: Record<string, number> = {}
  for (const id of studentIds) deltaMap[id] = 0

  if (rules && rules.length > 0) {
    const { data: classes } = await (db as any)
      .from('classes')
      .select('id')
      .eq('academy_id', academyId)
    const classIds = (classes ?? []).map((c: any) => c.id) as string[]

    if (classIds.length > 0) {
      // --- 출결 ---
      const attRules = (rules as LivesRule[]).filter(r => r.condition_type === 'attendance')
      if (attRules.length > 0) {
        const { data: sessions } = await (db as any)
          .from('sessions')
          .select('id, date')
          .in('class_id', classIds)
          .gte('date', autoFrom)
        if (sessions && sessions.length > 0) {
          const sessDateMap: Record<string, string> = {}
          for (const s of sessions) sessDateMap[s.id] = s.date
          const { data: attRows } = await (db as any)
            .from('attendance')
            .select('student_id, status, session_id')
            .in('session_id', (sessions as any[]).map(s => s.id))
          for (const att of attRows ?? []) {
            if (!(att.student_id in deltaMap)) continue
            for (const rule of attRules) {
              if (checkCondition(rule, 'attendance', { status: att.status, date: sessDateMap[att.session_id] }))
                deltaMap[att.student_id] += rule.delta
            }
          }
        }
      }

      // --- 과제 ---
      const hwRules = (rules as LivesRule[]).filter(r => r.condition_type === 'homework')
      if (hwRules.length > 0) {
        const { data: homeworks } = await (db as any)
          .from('homework')
          .select('id, assigned_date')
          .in('class_id', classIds)
          .gte('assigned_date', autoFrom)
        if (homeworks && homeworks.length > 0) {
          const hwDateMap: Record<string, string> = {}
          for (const h of homeworks) hwDateMap[h.id] = h.assigned_date
          const { data: hwStatusRows } = await (db as any)
            .from('homework_status')
            .select('student_id, status, homework_id')
            .in('homework_id', (homeworks as any[]).map(h => h.id))
          for (const hs of hwStatusRows ?? []) {
            if (!(hs.student_id in deltaMap)) continue
            for (const rule of hwRules) {
              if (checkCondition(rule, 'homework', { status: hs.status, date: hwDateMap[hs.homework_id] }))
                deltaMap[hs.student_id] += rule.delta
            }
          }
        }
      }

      // --- 클리닉 ---
      const clinicRules = (rules as LivesRule[]).filter(r => r.condition_type === 'clinic')
      if (clinicRules.length > 0) {
        const { data: clinicSessions } = await (db as any)
          .from('clinic_sessions')
          .select('id, date')
          .in('class_id', classIds)
          .gte('date', autoFrom)
        if (clinicSessions && clinicSessions.length > 0) {
          const csDateMap: Record<string, string> = {}
          for (const s of clinicSessions) csDateMap[s.id] = s.date
          const { data: clinicAttRows } = await (db as any)
            .from('clinic_attendance')
            .select('student_id, status, clinic_session_id')
            .in('clinic_session_id', (clinicSessions as any[]).map(s => s.id))
          for (const ca of clinicAttRows ?? []) {
            if (!(ca.student_id in deltaMap)) continue
            for (const rule of clinicRules) {
              if (checkCondition(rule, 'clinic', { status: ca.status, date: csDateMap[ca.clinic_session_id] }))
                deltaMap[ca.student_id] += rule.delta
            }
          }
        }
      }

      // --- 시험 점수 ---
      const examRules = (rules as LivesRule[]).filter(r => r.condition_type === 'exam_score')
      if (examRules.length > 0) {
        const { data: allExams } = await (db as any)
          .from('exams')
          .select('id, category, exam_format, max_score, exam_type, start_at, created_at')
          .in('class_id', classIds)
        const exams = ((allExams ?? []) as any[]).filter(e => {
          if ((e.exam_format ?? 'score') === 'pass_fail') return false
          const dateStr = e.start_at ? e.start_at.slice(0, 10) : e.created_at.slice(0, 10)
          return dateStr >= autoFrom
        })
        if (exams.length > 0) {
          const autoExamIds = exams.filter(e => e.exam_type === 'auto').map(e => e.id)
          const maxScoreByExam: Record<string, number> = {}
          if (autoExamIds.length > 0) {
            const { data: qRows } = await (db as any)
              .from('exam_questions')
              .select('exam_id, score')
              .in('exam_id', autoExamIds)
            for (const q of qRows ?? []) {
              maxScoreByExam[q.exam_id] = (maxScoreByExam[q.exam_id] ?? 0) + Number(q.score)
            }
          }
          for (const exam of exams) {
            const maxScore = exam.exam_type === 'manual' ? exam.max_score : (maxScoreByExam[exam.id] ?? null)
            if (!maxScore || maxScore <= 0) continue
            const examDate = exam.start_at ? exam.start_at.slice(0, 10) : exam.created_at.slice(0, 10)
            const { data: subs } = await (db as any)
              .from('exam_submissions')
              .select('student_id, auto_score, adjusted_score')
              .eq('exam_id', exam.id)
              .eq('is_submitted', true)
              .eq('is_forfeited', false)
            for (const sub of subs ?? []) {
              if (!(sub.student_id in deltaMap)) continue
              const score = sub.adjusted_score ?? sub.auto_score
              if (score === null) continue
              for (const rule of examRules) {
                if (checkCondition(rule, 'exam_score', {
                  score,
                  maxScore,
                  date: examDate,
                  category: exam.category ?? null,
                  examFormat: exam.exam_format ?? 'score',
                }))
                  deltaMap[sub.student_id] += rule.delta
              }
            }
          }
        }
      }
    }
  }

  const updates = studentIds.map(id => ({
    academy_id: academyId,
    student_id: id,
    lives: livesDefault + (deltaMap[id] ?? 0),
    updated_at: new Date().toISOString(),
  }))
  await (db as any).from('student_lives').upsert(updates, { onConflict: 'academy_id,student_id' })
}
