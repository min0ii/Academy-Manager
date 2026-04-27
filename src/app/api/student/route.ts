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
// 학생 포털용 기본 정보 (학생 정보 + 반 정보)
// RLS 우회를 위해 서비스 롤 사용
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

  // 학생 정보 (user_id로 연결)
  const { data: student } = await db.from('students')
    .select('id, name, school_name, grade, phone')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!student) return NextResponse.json({ student: null, classInfo: null, academyName: '' })

  // 반 정보
  const { data: classStudents } = await db.from('class_students')
    .select('classes(id, name, academy_id, teacher_id, academies(name), class_schedules(day_of_week, start_time, end_time))')
    .eq('student_id', student.id)

  if (!classStudents || classStudents.length === 0)
    return NextResponse.json({ student, classInfo: null, academyName: '' })

  const cls = (classStudents[0] as any).classes
  if (!cls) return NextResponse.json({ student, classInfo: null, academyName: '' })

  const academyName = cls.academies?.name ?? ''

  // 담당 선생님 이름
  let teacherName: string | null = null
  if (cls.teacher_id) {
    const { data: tp } = await db.from('profiles').select('name').eq('id', cls.teacher_id).single()
    teacherName = tp?.name ?? null
  }

  const classInfo = {
    id: cls.id,
    name: cls.name,
    teacher_name: teacherName,
    schedules: cls.class_schedules ?? [],
  }

  return NextResponse.json({ student, classInfo, academyName })
}

// GET /api/student?action=attendance&classId=xxx&studentId=xxx
// 학생 출석 기록 (서비스 롤로 RLS 우회)
export async function POST(req: NextRequest) {
  return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })
}
