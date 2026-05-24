import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET /api/student
// 학생 포털용 기본 정보 — 같은 번호로 여러 학원에 다닐 수 있으므로 contexts[] 배열로 반환
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()

  // 토큰으로 유저 확인
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return NextResponse.json({ error: '인증 오류' }, { status: 401 })

  // role 확인
  const { data: profile } = await db.from('profiles')
    .select('role, must_change_password')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'student')
    return NextResponse.json({ error: '학생 계정이 아니에요.' }, { status: 403 })

  // 이 user_id에 연결된 재원 중인 학생 행만 조회 (퇴원 학생 제외)
  const { data: students } = await db.from('students')
    .select('id, name, school_name, grade, phone, status')
    .eq('user_id', user.id)

  const activeStudents = (students ?? []).filter(s => s.status !== 'inactive')

  if (activeStudents.length === 0)
    return NextResponse.json({ contexts: [] })

  // 각 학생 행에 대해 반·학원 정보 조회
  const contexts = []

  for (const student of activeStudents) {
    const { data: classStudents } = await db.from('class_students')
      .select('classes(id, name, academy_id, teacher_id, academies(name, logo_url), class_schedules(day_of_week, start_time, end_time))')
      .eq('student_id', student.id)

    if (!classStudents || classStudents.length === 0) {
      contexts.push({ student, classInfo: null, academyName: '', academyLogo: null })
      continue
    }

    const cls = (classStudents[0] as any).classes
    if (!cls) {
      contexts.push({ student, classInfo: null, academyName: '', academyLogo: null })
      continue
    }

    const academyName = cls.academies?.name ?? ''
    const academyLogo = cls.academies?.logo_url ?? null

    let teacherName: string | null = null
    if (cls.teacher_id) {
      const { data: tp } = await db.from('profiles').select('name').eq('id', cls.teacher_id).single()
      teacherName = tp?.name ?? null
    }

    contexts.push({
      student,
      classInfo: {
        id: cls.id,
        name: cls.name,
        teacher_name: teacherName,
        schedules: cls.class_schedules ?? [],
      },
      academyName,
      academyLogo,
    })
  }

  return NextResponse.json({ contexts })
}

export async function POST(req: NextRequest) {
  return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })
}
