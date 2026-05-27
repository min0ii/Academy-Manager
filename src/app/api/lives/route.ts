import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { applyLivesRulesInternal, recalculate } from '@/lib/lives-auto'

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
  return p?.role === 'teacher' ? user.id : null
}

// GET /api/lives
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const db = admin()

  // ── 학생 앱: 내 목숨 조회 ──────────────────────────────────────────
  if (action === 'my-lives') {
    const { data: { user } } = await db.auth.getUser(token)
    if (!user) return NextResponse.json({ error: '인증 실패' }, { status: 401 })

    const studentId = searchParams.get('studentId')
    if (!studentId) return NextResponse.json({ error: '학생 ID 필요' }, { status: 400 })

    const { data: studentRow } = await db
      .from('students').select('id, academy_id').eq('id', studentId).eq('user_id', user.id).single()
    if (!studentRow) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const academyId = studentRow.academy_id
    const { data: academy } = await db
      .from('academies').select('lives_enabled, lives_default').eq('id', academyId).single()
    if (!academy?.lives_enabled) return NextResponse.json({ enabled: false, lives: 0 })

    const { data: rec } = await db
      .from('student_lives').select('lives').eq('academy_id', academyId).eq('student_id', studentId).single()
    const lives = rec?.lives ?? (academy.lives_default ?? 3)
    return NextResponse.json({ enabled: true, lives, livesDefault: academy.lives_default ?? 3 })
  }

  // ── 선생님: 자동화 규칙 + 설정 조회 ──────────────────────────────
  if (action === 'rules') {
    const teacherId = await verifyTeacher(db, token)
    if (!teacherId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const academyId = searchParams.get('academyId')
    if (!academyId) return NextResponse.json({ error: 'academyId 필요' }, { status: 400 })

    const [{ data: academy }, { data: rules }] = await Promise.all([
      db.from('academies').select('lives_auto_enabled, lives_auto_from').eq('id', academyId).single(),
      db.from('lives_rules').select('*').eq('academy_id', academyId).order('created_at'),
    ])

    return NextResponse.json({
      livesAutoEnabled: (academy as any)?.lives_auto_enabled ?? false,
      livesAutoFrom: (academy as any)?.lives_auto_from ?? null,
      rules: rules ?? [],
    })
  }

  return NextResponse.json({ error: '잘못된 action' }, { status: 400 })
}

// POST /api/lives
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const db = admin()
  const body = await req.json().catch(() => ({}))
  const action = body?.action

  // ── 실시간 규칙 적용 (선생님이 출결/과제/클리닉 기록 후 호출) ──────
  if (action === 'apply-rules') {
    const teacherId = await verifyTeacher(db, token)
    if (!teacherId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { academyId, studentId, eventType, eventDetail } = body
    if (!academyId || !studentId || !eventType || !eventDetail)
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 })

    await applyLivesRulesInternal(db, academyId, studentId, eventType, eventDetail)
    return NextResponse.json({ success: true })
  }

  // ── 자동화 설정 저장 ───────────────────────────────────────────────
  if (action === 'save-auto-settings') {
    const teacherId = await verifyTeacher(db, token)
    if (!teacherId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { academyId, livesAutoEnabled, livesAutoFrom } = body
    if (!academyId) return NextResponse.json({ error: 'academyId 필요' }, { status: 400 })

    const { data: prev } = await db
      .from('academies').select('lives_auto_enabled, lives_auto_from').eq('id', academyId).single()
    const prevEnabled  = (prev as any)?.lives_auto_enabled ?? false
    const prevFrom     = (prev as any)?.lives_auto_from ?? null

    await db.from('academies').update({
      lives_auto_enabled: livesAutoEnabled,
      lives_auto_from: livesAutoFrom || null,
    }).eq('id', academyId)

    const shouldRecalc =
      livesAutoEnabled &&
      livesAutoFrom &&
      (!prevEnabled || prevFrom !== livesAutoFrom)

    if (shouldRecalc) {
      // 재계산은 background에서 (응답 후 실행)
      void recalculate(db, academyId)
    }

    return NextResponse.json({ success: true, recalculating: shouldRecalc })
  }

  // ── 규칙 생성 ────────────────────────────────────────────────────
  if (action === 'create-rule') {
    const teacherId = await verifyTeacher(db, token)
    if (!teacherId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { academyId, name, condition_type, condition_detail, delta } = body
    if (!academyId || !name || !condition_type || !condition_detail || delta === undefined)
      return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 })

    const { data, error } = await db.from('lives_rules').insert({
      academy_id: academyId, name, condition_type, condition_detail, delta, enabled: true,
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rule: data })
  }

  // ── 규칙 수정 (toggle enabled / update) ─────────────────────────
  if (action === 'update-rule') {
    const teacherId = await verifyTeacher(db, token)
    if (!teacherId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { ruleId, enabled } = body
    if (!ruleId) return NextResponse.json({ error: 'ruleId 필요' }, { status: 400 })

    await db.from('lives_rules').update({ enabled }).eq('id', ruleId)
    return NextResponse.json({ success: true })
  }

  // ── 규칙 삭제 ────────────────────────────────────────────────────
  if (action === 'delete-rule') {
    const teacherId = await verifyTeacher(db, token)
    if (!teacherId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { ruleId } = body
    if (!ruleId) return NextResponse.json({ error: 'ruleId 필요' }, { status: 400 })

    await db.from('lives_rules').delete().eq('id', ruleId)
    return NextResponse.json({ success: true })
  }

  // ── 수동 재계산 ──────────────────────────────────────────────────
  if (action === 'recalculate') {
    const teacherId = await verifyTeacher(db, token)
    if (!teacherId) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { academyId } = body
    if (!academyId) return NextResponse.json({ error: 'academyId 필요' }, { status: 400 })

    await recalculate(db, academyId)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: '잘못된 action' }, { status: 400 })
}
