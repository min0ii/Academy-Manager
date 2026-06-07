import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET /api/parent/overview
// 학부모 포털 첫 진입용 — 자녀 목록 + 각 자녀의 반·학원·담당선생님을 한 번에 반환
// (기존 클라이언트의 N+1 순차 조회를 서버 1회 호출 + 병렬 처리로 대체)
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return NextResponse.json({ error: '인증 오류' }, { status: 401 })

  // 본인 전화번호 → 연결된 자녀(재원 여부 무관, 기존 동작 유지)
  const { data: profile } = await db.from('profiles').select('name, phone').eq('id', user.id).single()
  const parentPhone = profile?.phone ?? ''
  if (!parentPhone) return NextResponse.json({ parentName: profile?.name ?? '', contexts: [] })

  const { data: students } = await db.from('students')
    .select('id, name, school_name, grade, phone, enrolled_at')
    .eq('parent_phone', parentPhone)

  if (!students?.length)
    return NextResponse.json({ parentName: profile?.name ?? '', contexts: [] })

  // 자녀별 반·학원·선생님 정보를 병렬로 조회
  const contexts = await Promise.all(students.map(async (s: any) => {
    const { data: cs } = await db.from('class_students')
      .select('classes(id, name, academy_id, teacher_id, academies(name, logo_url), class_schedules(day_of_week, start_time, end_time))')
      .eq('student_id', s.id)

    const cls = (cs?.[0] as any)?.classes
    if (!cls) return { student: s, classInfo: null, academyName: '', academyLogo: null }

    let teacherName: string | null = null
    if (cls.teacher_id) {
      const { data: tp } = await db.from('profiles').select('name').eq('id', cls.teacher_id).single()
      teacherName = tp?.name ?? null
    }

    return {
      student: s,
      classInfo: { id: cls.id, name: cls.name, teacher_name: teacherName, schedules: cls.class_schedules ?? [] },
      academyName: cls.academies?.name ?? '',
      academyLogo: (cls.academies as any)?.logo_url ?? null,
    }
  }))

  return NextResponse.json({ parentName: profile?.name ?? '', contexts })
}
