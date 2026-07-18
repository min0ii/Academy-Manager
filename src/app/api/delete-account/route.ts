import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY 환경변수가 없어요.' }, { status: 500 })
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    // 요청자 인증
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

    const { data: { user: requester }, error: authError } = await db.auth.getUser(token)
    if (authError || !requester) return NextResponse.json({ error: '인증 오류.' }, { status: 401 })

    // 선생님 권한 확인 (조교 제외)
    const { data: membership } = await db
      .from('academy_teachers').select('academy_id, title').eq('teacher_id', requester.id).single()

    if (!membership || membership.title === '조교') {
      return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })
    }

    const body = await req.json()
    const studentIds: string[] = body.student_ids ?? (body.student_id ? [body.student_id] : [])
    const targetType: 'student' | 'parent' | 'both' = body.target ?? 'student'

    if (studentIds.length === 0)
      return NextResponse.json({ error: '잘못된 요청이에요.' }, { status: 400 })

    // 학원 소속 학생 조회
    const { data: studentRows } = await db
      .from('students')
      .select('id, name, user_id, parent_phone')
      .in('id', studentIds)
      .eq('academy_id', membership.academy_id)

    if (!studentRows || studentRows.length === 0)
      return NextResponse.json({ error: '학생을 찾을 수 없어요.' }, { status: 404 })

    const errors: string[] = []

    // ── 학생 삭제 태스크 ──
    const studentTask = async () => {
      if (targetType !== 'student' && targetType !== 'both') return
      for (const s of studentRows) {
        if (!s.user_id) continue

        // 다른 학원 확인(SELECT)과 user_id 초기화(UPDATE)를 동시에 실행
        const [{ data: allUserRows }] = await Promise.all([
          db.from('students').select('id').eq('user_id', s.user_id),
          db.from('students').update({ user_id: null }).eq('id', s.id),
        ])
        const otherRows = (allUserRows ?? []).filter(r => !studentIds.includes(r.id))

        if (otherRows.length === 0) {
          // 마지막 학원 → auth 계정 + profile 삭제
          const { error: delErr } = await db.auth.admin.deleteUser(s.user_id)
          if (delErr) errors.push(`${s.name} 학생 계정 삭제 오류: ${delErr.message}`)
          else await db.from('profiles').delete().eq('id', s.user_id)
        }
      }
    }

    // ── 학부모 삭제 태스크 ──
    // 자녀가 여럿이거나 다른 학원에도 자녀가 있으면 계정 유지
    const parentTask = async () => {
      if (targetType !== 'parent' && targetType !== 'both') return
      for (const s of studentRows) {
        let deletedParentId: string | null = null
        let foundViaLink = false

        // 방법 1: parent_students 테이블 (정상 경로 — 계정 생성 시 채워짐)
        const { data: parentLinks } = await db
          .from('parent_students').select('parent_id').eq('student_id', s.id)

        for (const link of parentLinks ?? []) {
          foundViaLink = true

          // 이 자녀와의 링크 삭제
          await db.from('parent_students')
            .delete().eq('parent_id', link.parent_id).eq('student_id', s.id)

          // 남은 자녀 링크 확인 (링크 삭제 후에 확인해야 정확함)
          const { data: remaining } = await db
            .from('parent_students').select('student_id').eq('parent_id', link.parent_id)

          if (!remaining || remaining.length === 0) {
            deletedParentId = link.parent_id
          }
        }

        // 방법 2: parent_phone 기반 fallback (parent_students 미사용 레거시 데이터)
        if (!foundViaLink && s.parent_phone) {
          const parentPhone = String(s.parent_phone).replace(/\D/g, '')
          const { data: parentProfile } = await db
            .from('profiles').select('id').eq('phone', parentPhone).eq('role', 'parent').maybeSingle()

          if (parentProfile) {
            const { data: allSamePhone } = await db
              .from('students').select('id').eq('parent_phone', s.parent_phone)
            const otherChildren = (allSamePhone ?? []).filter(r => !studentIds.includes(r.id))

            if (otherChildren.length === 0) {
              deletedParentId = parentProfile.id
            }
          }
        }

        if (deletedParentId) {
          const { error: delErr } = await db.auth.admin.deleteUser(deletedParentId)
          if (delErr) errors.push(`학부모 계정 삭제 오류: ${delErr.message}`)
          else await db.from('profiles').delete().eq('id', deletedParentId)
        }
      }
    }

    // 학생 삭제와 학부모 삭제를 동시에 실행
    await Promise.all([studentTask(), parentTask()])

    return NextResponse.json({ success: true, errors })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했어요.' }, { status: 500 })
  }
}
