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

    // ── 학생 계정 삭제 ──
    // 같은 전화번호(user_id)로 다른 학원에도 다니고 있으면 auth 계정은 유지하고
    // 이 학원 학생 row의 user_id만 null로 초기화
    if (targetType === 'student' || targetType === 'both') {
      for (const s of studentRows) {
        if (!s.user_id) continue

        // 같은 user_id를 쓰는 다른 학생 행이 있는지 확인 (다른 학원)
        const { data: allUserRows } = await db
          .from('students').select('id').eq('user_id', s.user_id)
        const otherRows = (allUserRows ?? []).filter(r => !studentIds.includes(r.id))

        // 이 학원 student row의 user_id 초기화 (항상)
        await db.from('students').update({ user_id: null }).eq('id', s.id)

        if (otherRows.length > 0) {
          // 다른 학원에도 등록되어 있음 → auth 계정은 유지
        } else {
          // 마지막 학원 → auth 계정 + profile 삭제
          const { error: delErr } = await db.auth.admin.deleteUser(s.user_id)
          if (delErr) errors.push(`${s.name} 학생 계정 삭제 오류: ${delErr.message}`)
          else await db.from('profiles').delete().eq('id', s.user_id)
        }
      }
    }

    // ── 학부모 계정 삭제 ──
    // 자녀가 여럿이거나 다른 학원에도 자녀가 있으면 계정 유지
    if (targetType === 'parent' || targetType === 'both') {
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

          // 남은 자녀 링크 확인
          const { data: remaining } = await db
            .from('parent_students').select('student_id').eq('parent_id', link.parent_id)

          if (!remaining || remaining.length === 0) {
            // 마지막 자녀 → 학부모 계정 삭제 대상
            deletedParentId = link.parent_id
          }
          // else: 다른 자녀 여전히 있음 → 계정 유지
        }

        // 방법 2: parent_phone 기반 fallback (parent_students 미사용 레거시 데이터)
        if (!foundViaLink && s.parent_phone) {
          const parentPhone = String(s.parent_phone).replace(/\D/g, '')
          const { data: parentProfile } = await db
            .from('profiles').select('id').eq('phone', parentPhone).eq('role', 'parent').maybeSingle()

          if (parentProfile) {
            // 이 학부모의 다른 재원 자녀가 있는지 parent_phone으로 확인
            const { data: allSamePhone } = await db
              .from('students').select('id').eq('parent_phone', s.parent_phone)
            const otherChildren = (allSamePhone ?? []).filter(r => !studentIds.includes(r.id))

            if (otherChildren.length === 0) {
              // 퇴원하는 학생이 유일한 자녀 → 학부모 계정 삭제 대상
              deletedParentId = parentProfile.id
            }
          }
        }

        // 학부모 계정 삭제
        if (deletedParentId) {
          const { error: delErr } = await db.auth.admin.deleteUser(deletedParentId)
          if (delErr) errors.push(`학부모 계정 삭제 오류: ${delErr.message}`)
          else await db.from('profiles').delete().eq('id', deletedParentId)
        }
      }
    }

    return NextResponse.json({ success: true, errors })
  } catch {
    return NextResponse.json({ error: '서버 오류가 발생했어요.' }, { status: 500 })
  }
}
