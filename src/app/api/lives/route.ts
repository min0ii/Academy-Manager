import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { applyLivesRulesInternal, recalculate, recalculateStudent } from '@/lib/lives-auto'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// 선생님 인증 + 소속 학원 ID 반환 (없으면 null)
async function verifyTeacher(db: ReturnType<typeof admin>, token: string) {
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return null
  const { data: p } = await db.from('profiles').select('role').eq('id', user.id).single()
  if (p?.role !== 'teacher') return null
  const { data: m } = await db.from('academy_teachers').select('academy_id').eq('teacher_id', user.id).single()
  return m?.academy_id ?? null
}

// 규칙 ID가 이 선생님의 학원 소속인지 검증
async function ruleInAcademy(db: ReturnType<typeof admin>, ruleId: string, academyId: string) {
  const { data } = await db.from('lives_rules').select('academy_id').eq('id', ruleId).single()
  return (data as any)?.academy_id === academyId ? academyId : null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const db = admin()

  if (action === 'my-lives') {
    const { data: { user } } = await db.auth.getUser(token)
    if (!user) return NextResponse.json({ error: '인증 실패' }, { status: 401 })

    const studentId = searchParams.get('studentId')
    if (!studentId) return NextResponse.json({ error: '학생 ID 필요' }, { status: 400 })

    const { data: studentRow } = await db
      .from('students').select('id, academy_id').eq('id', studentId).eq('user_id', user.id).single()
    if (!studentRow) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const academyId = studentRow.academy_id
    const [{ data: academy }, { data: classStudent }] = await Promise.all([
      db.from('academies').select('lives_enabled, lives_default').eq('id', academyId).single(),
      db.from('class_students').select('classes(lives_enabled)').eq('student_id', studentId).maybeSingle(),
    ])
    if (!academy?.lives_enabled) return NextResponse.json({ enabled: false, lives: 0 })

    const classLivesEnabled = (classStudent as any)?.classes?.lives_enabled ?? true
    if (!classLivesEnabled) return NextResponse.json({ enabled: false, lives: 0 })

    const { data: rec } = await db
      .from('student_lives').select('lives').eq('academy_id', academyId).eq('student_id', studentId).single()
    const lives = rec?.lives ?? (academy.lives_default ?? 3)
    return NextResponse.json({ enabled: true, lives, livesDefault: academy.lives_default ?? 3, academyId })
  }

  if (action === 'rules') {
    const myAcademyId = await verifyTeacher(db, token)
    if (!myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const academyId = searchParams.get('academyId')
    if (!academyId) return NextResponse.json({ error: 'academyId 필요' }, { status: 400 })
    if (academyId !== myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const [{ data: academy }, { data: rules }] = await Promise.all([
      db.from('academies').select('lives_auto_enabled, lives_auto_from').eq('id', academyId).single(),
      db.from('lives_rules').select('*').eq('academy_id', academyId).order('order_num').order('created_at'),
    ])

    return NextResponse.json({
      livesAutoEnabled: (academy as any)?.lives_auto_enabled ?? false,
      livesAutoFrom: (academy as any)?.lives_auto_from ?? null,
      rules: rules ?? [],
    })
  }

  // 목숨 변동 내역 — 학생/선생님 공통
  if (action === 'lives-log') {
    const { data: { user } } = await db.auth.getUser(token)
    if (!user) return NextResponse.json({ error: '인증 실패' }, { status: 401 })

    const studentId = searchParams.get('studentId')
    const academyId = searchParams.get('academyId')
    if (!studentId || !academyId) return NextResponse.json({ error: '파라미터 누락' }, { status: 400 })

    // 권한 확인: 본인 학생이거나 선생님
    const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role === 'student') {
      const { data: s } = await db.from('students').select('id').eq('id', studentId).eq('user_id', user.id).single()
      if (!s) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
    } else if (profile?.role === 'parent') {
      const { data: ps } = await db.from('parent_students').select('student_id').eq('parent_id', user.id).eq('student_id', studentId).single()
      if (!ps) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
    } else if (profile?.role === 'teacher') {
      // 선생님은 본인 학원 학생만 열람 가능
      const { data: m } = await db.from('academy_teachers').select('academy_id').eq('teacher_id', user.id).single()
      if (!m || m.academy_id !== academyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
    } else {
      return NextResponse.json({ error: '권한 없음' }, { status: 403 })
    }

    const isTeacher = profile?.role === 'teacher'
    const query = db.from('student_lives_log')
      .select('id, delta, reason, source, lives_after, created_at, triggered_at, hidden')
      .eq('academy_id', academyId)
      .eq('student_id', studentId)
      .order('triggered_at', { ascending: false, nullsFirst: false })

    const { data: logs } = isTeacher ? await query : await query.eq('hidden', false)

    return NextResponse.json({ logs: logs ?? [] })
  }

  return NextResponse.json({ error: '잘못된 action' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const db = admin()
  const body = await req.json().catch(() => ({}))
  const action = body?.action

  if (action === 'apply-rules') {
    const myAcademyId = await verifyTeacher(db, token)
    if (!myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { academyId, studentId, eventType, eventDetail } = body
    if (!academyId || !studentId || !eventType || !eventDetail)
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 })
    if (academyId !== myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    await applyLivesRulesInternal(db, academyId, studentId, eventType, eventDetail)
    return NextResponse.json({ success: true })
  }

  // 선생님 수동 목숨 조정 (디바운스 후 최종값으로 호출)
  if (action === 'manual-adjust') {
    const myAcademyId = await verifyTeacher(db, token)
    if (!myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { academyId, studentId, delta, reason } = body
    if (!academyId || !studentId || delta === undefined || delta === 0)
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 })
    if (academyId !== myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { data: academy } = await db.from('academies').select('lives_default').eq('id', academyId).single()
    const { data: current } = await db.from('student_lives').select('lives')
      .eq('academy_id', academyId).eq('student_id', studentId).maybeSingle()
    const currentLives = current?.lives ?? (academy?.lives_default ?? 3)
    const newLives = currentLives + delta

    await db.from('student_lives').upsert(
      { academy_id: academyId, student_id: studentId, lives: newLives, updated_at: new Date().toISOString() },
      { onConflict: 'academy_id,student_id' }
    )
    await db.from('student_lives_log').insert({
      academy_id: academyId,
      student_id: studentId,
      delta,
      reason: reason?.trim() || '선생님이 수정했어요',
      source: 'manual',
      lives_after: newLives,
      created_at: new Date().toISOString(),
      triggered_at: new Date().toISOString(),
    })

    return NextResponse.json({ success: true, lives: newLives })
  }

  if (action === 'save-auto-settings') {
    const myAcademyId = await verifyTeacher(db, token)
    if (!myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { academyId, livesAutoEnabled, livesAutoFrom } = body
    if (!academyId) return NextResponse.json({ error: 'academyId 필요' }, { status: 400 })
    if (academyId !== myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { data: prev } = await db
      .from('academies').select('lives_auto_enabled, lives_auto_from').eq('id', academyId).single()
    const prevEnabled = (prev as any)?.lives_auto_enabled ?? false
    const prevFrom    = (prev as any)?.lives_auto_from ?? null

    await db.from('academies').update({
      lives_auto_enabled: livesAutoEnabled,
      lives_auto_from: livesAutoFrom || null,
    }).eq('id', academyId)

    const shouldRecalc = livesAutoEnabled && livesAutoFrom && (!prevEnabled || prevFrom !== livesAutoFrom)
    if (shouldRecalc) void recalculate(db, academyId)

    return NextResponse.json({ success: true, recalculating: shouldRecalc })
  }

  if (action === 'create-rule') {
    const myAcademyId = await verifyTeacher(db, token)
    if (!myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { academyId, name, condition_type, condition_detail, delta } = body
    if (!academyId || !name || !condition_type || !condition_detail || delta === undefined)
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 })
    if (academyId !== myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { data: existing } = await db.from('lives_rules').select('id').eq('academy_id', academyId)
    const orderNum = (existing ?? []).length

    const { data, error } = await db.from('lives_rules').insert({
      academy_id: academyId, name, condition_type, condition_detail, delta, enabled: true,
      order_num: orderNum,
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    void recalculate(db, academyId)
    return NextResponse.json({ rule: data })
  }

  if (action === 'update-rule') {
    const myAcademyId = await verifyTeacher(db, token)
    if (!myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { ruleId, enabled } = body
    if (!ruleId) return NextResponse.json({ error: 'ruleId 필요' }, { status: 400 })

    const { data: rule } = await db.from('lives_rules').select('academy_id').eq('id', ruleId).single()
    if (!rule || (rule as any).academy_id !== myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
    await db.from('lives_rules').update({ enabled }).eq('id', ruleId)
    void recalculate(db, (rule as any).academy_id)
    return NextResponse.json({ success: true })
  }

  if (action === 'delete-rule') {
    const myAcademyId = await verifyTeacher(db, token)
    if (!myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { ruleId } = body
    if (!ruleId) return NextResponse.json({ error: 'ruleId 필요' }, { status: 400 })

    const { data: rule } = await db.from('lives_rules').select('academy_id').eq('id', ruleId).single()
    if (!rule || (rule as any).academy_id !== myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
    await db.from('lives_rules').delete().eq('id', ruleId)
    void recalculate(db, (rule as any).academy_id)
    return NextResponse.json({ success: true })
  }

  if (action === 'reorder-rules') {
    const myAcademyId = await verifyTeacher(db, token)
    if (!myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { ruleIds } = body
    if (!Array.isArray(ruleIds)) return NextResponse.json({ error: 'ruleIds 필요' }, { status: 400 })

    // 모든 규칙이 내 학원 소속인지 확인
    const { data: rulesToReorder } = await db.from('lives_rules').select('id, academy_id').in('id', ruleIds)
    const allMine = (rulesToReorder ?? []).length === ruleIds.length &&
      (rulesToReorder ?? []).every((r: any) => r.academy_id === myAcademyId)
    if (!allMine) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    await Promise.all(
      ruleIds.map((id: string, idx: number) =>
        db.from('lives_rules').update({ order_num: idx }).eq('id', id)
      )
    )
    return NextResponse.json({ success: true })
  }

  if (action === 'recalculate') {
    const myAcademyId = await verifyTeacher(db, token)
    if (!myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { academyId, studentId } = body
    if (!academyId) return NextResponse.json({ error: 'academyId 필요' }, { status: 400 })
    if (academyId !== myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    if (studentId) await recalculateStudent(db, academyId, studentId)
    else await recalculate(db, academyId)
    return NextResponse.json({ success: true })
  }

  if (action === 'set-log-hidden') {
    const myAcademyId = await verifyTeacher(db, token)
    if (!myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { logId, hidden } = body
    if (!logId || typeof hidden !== 'boolean') return NextResponse.json({ error: '파라미터 누락' }, { status: 400 })

    const { data: log } = await db.from('student_lives_log').select('academy_id').eq('id', logId).single()
    if (!log || log.academy_id !== myAcademyId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    await db.from('student_lives_log').update({ hidden }).eq('id', logId)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: '잘못된 action' }, { status: 400 })
}
