import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET: 학생 본인 질문 조회 (?examId=&studentId=) 또는 선생님 전체 조회 (?academyId=)
export async function GET(req: NextRequest) {
  const db = admin()
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = await db.auth.getUser(token ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const examId    = searchParams.get('examId')
  const studentId = searchParams.get('studentId')
  const academyId = searchParams.get('academyId')

  // ── 학생: 본인 시험 질문 조회 ──
  if (examId && studentId) {
    // 본인 확인
    const { data: student } = await db.from('students').select('id').eq('user_id', user.id).eq('id', studentId).maybeSingle()
    if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { data: inquiries } = await db
      .from('exam_inquiries')
      .select('id, body, created_at, question_id, exam_questions (order_num, question_text), exam_inquiry_replies (id, body, created_at, teacher_id)')
      .eq('exam_id', examId)
      .eq('student_id', studentId)
      .order('created_at')

    // 선생님 이름 병합
    const teacherIds = [...new Set((inquiries ?? []).flatMap(i =>
      (i.exam_inquiry_replies as { teacher_id: string }[]).map(r => r.teacher_id)
    ))]
    const teacherMap: Record<string, string> = {}
    if (teacherIds.length > 0) {
      const { data: profiles } = await db.from('profiles').select('id, name').in('id', teacherIds)
      ;(profiles ?? []).forEach(p => { teacherMap[p.id] = p.name })
    }

    const result = (inquiries ?? []).map(inq => ({
      ...inq,
      exam_inquiry_replies: (inq.exam_inquiry_replies as { id: string; body: string; created_at: string; teacher_id: string }[]).map(r => ({
        ...r,
        teacherName: teacherMap[r.teacher_id] ?? '선생님'
      }))
    }))

    return NextResponse.json({ inquiries: result })
  }

  // ── 선생님: 학원 전체 질문 조회 ──
  if (academyId) {
    // 권한 확인 (원장 또는 팀 선생님)
    const { data: ownAcademy } = await db.from('academies').select('id').eq('id', academyId).eq('teacher_id', user.id).maybeSingle()
    const { data: teamMember } = await db.from('academy_teachers').select('academy_id').eq('academy_id', academyId).eq('teacher_id', user.id).maybeSingle()
    if (!ownAcademy && !teamMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // 학원 → 반 → 시험 순으로 조회
    const { data: classes } = await db.from('classes').select('id').eq('academy_id', academyId)
    const classIds = (classes ?? []).map(c => c.id)
    if (classIds.length === 0) return NextResponse.json({ inquiries: [] })

    const { data: exams } = await db.from('exams').select('id, title').in('class_id', classIds)
    const examMap: Record<string, string> = {}
    ;(exams ?? []).forEach(e => { examMap[e.id] = e.title })
    const examIds = Object.keys(examMap)
    if (examIds.length === 0) return NextResponse.json({ inquiries: [] })

    const { data: inquiries } = await db
      .from('exam_inquiries')
      .select('id, exam_id, body, created_at, question_id, exam_questions (order_num, question_text), students (id, name), exam_inquiry_replies (id, body, created_at, teacher_id)')
      .in('exam_id', examIds)
      .order('created_at', { ascending: false })

    // 선생님 이름 병합
    const teacherIds = [...new Set((inquiries ?? []).flatMap(i =>
      (i.exam_inquiry_replies as { teacher_id: string }[]).map(r => r.teacher_id)
    ))]
    const teacherMap: Record<string, string> = {}
    if (teacherIds.length > 0) {
      const { data: profiles } = await db.from('profiles').select('id, name').in('id', teacherIds)
      ;(profiles ?? []).forEach(p => { teacherMap[p.id] = p.name })
    }

    const result = (inquiries ?? []).map(inq => ({
      ...inq,
      examTitle: examMap[inq.exam_id] ?? '시험',
      exam_inquiry_replies: (inq.exam_inquiry_replies as { id: string; body: string; created_at: string; teacher_id: string }[]).map(r => ({
        ...r,
        teacherName: teacherMap[r.teacher_id] ?? '선생님'
      }))
    }))

    return NextResponse.json({ inquiries: result })
  }

  return NextResponse.json({ error: 'Missing params' }, { status: 400 })
}

// POST: 학생 질문 등록 { examId, questionId?, body }
export async function POST(req: NextRequest) {
  const db = admin()
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = await db.auth.getUser(token ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { examId, questionId, body } = await req.json()
  if (!examId || !body?.trim()) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { data: student } = await db.from('students').select('id').eq('user_id', user.id).maybeSingle()
  if (!student) return NextResponse.json({ error: 'Not a student' }, { status: 403 })

  const { data: inquiry, error } = await db
    .from('exam_inquiries')
    .insert({ exam_id: examId, student_id: student.id, question_id: questionId ?? null, body: body.trim() })
    .select('id, body, created_at, question_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ inquiry: { ...inquiry, exam_inquiry_replies: [] } })
}
