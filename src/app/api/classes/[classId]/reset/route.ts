import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

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
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'teacher') return null
  return user.id
}

// POST /api/classes/[classId]/reset
// 반 기록 전체 초기화 (학생 명단·시간표 제외)
export async function POST(req: NextRequest, { params }: { params: Promise<{ classId: string }> }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const teacherId = await verifyTeacher(db, token)
  if (!teacherId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { classId } = await params

  // 반이 실제로 존재하는지 확인
  const { data: cls } = await db.from('classes').select('id, name').eq('id', classId).single()
  if (!cls) return NextResponse.json({ error: '반을 찾을 수 없어요.' }, { status: 404 })

  // 1. 시험 관련 (exam_submissions → exam_student_answers는 cascade 가정)
  const { data: exams } = await db.from('exams').select('id').eq('class_id', classId)
  const examIds = (exams ?? []).map(e => e.id)
  if (examIds.length > 0) {
    const { data: submissions } = await db.from('exam_submissions').select('id').in('exam_id', examIds)
    const subIds = (submissions ?? []).map(s => s.id)
    if (subIds.length > 0)
      await db.from('exam_student_answers').delete().in('submission_id', subIds)
    await db.from('exam_submissions').delete().in('exam_id', examIds)

    const { data: questions } = await db.from('exam_questions').select('id').in('exam_id', examIds)
    const qIds = (questions ?? []).map(q => q.id)
    if (qIds.length > 0) {
      await Promise.all([
        db.from('exam_choices').delete().in('question_id', qIds),
        db.from('exam_correct_answers').delete().in('question_id', qIds),
      ])
    }
    await db.from('exam_questions').delete().in('exam_id', examIds)
    await db.from('exams').delete().in('id', examIds)
  }

  // 2. 세션 → 출결
  const { data: sessions } = await db.from('sessions').select('id').eq('class_id', classId)
  const sessIds = (sessions ?? []).map(s => s.id)
  if (sessIds.length > 0)
    await db.from('attendance').delete().in('session_id', sessIds)
  await db.from('sessions').delete().eq('class_id', classId)

  // 3. 클리닉 세션 → 클리닉 출결
  const { data: clinicSessions } = await db.from('clinic_sessions').select('id').eq('class_id', classId)
  const csIds = (clinicSessions ?? []).map(s => s.id)
  if (csIds.length > 0)
    await db.from('clinic_attendance').delete().in('clinic_session_id', csIds)
  await db.from('clinic_sessions').delete().eq('class_id', classId)

  // 4. 숙제 → 숙제 상태
  const { data: homeworks } = await db.from('homework').select('id').eq('class_id', classId)
  const hwIds = (homeworks ?? []).map(h => h.id)
  if (hwIds.length > 0)
    await db.from('homework_status').delete().in('homework_id', hwIds)
  await db.from('homework').delete().eq('class_id', classId)

  // 5. 구형 성적 (tests → test_scores)
  const { data: tests } = await db.from('tests').select('id').eq('class_id', classId)
  const testIds = (tests ?? []).map(t => t.id)
  if (testIds.length > 0)
    await db.from('test_scores').delete().in('test_id', testIds)
  await db.from('tests').delete().eq('class_id', classId)

  // 6. grades (session 기반 성적)
  if (sessIds.length > 0)
    await db.from('grades').delete().in('session_id', sessIds)

  return NextResponse.json({ success: true })
}
