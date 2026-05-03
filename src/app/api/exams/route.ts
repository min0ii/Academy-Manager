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
  const { data: profile } = await db.from('profiles').select('role, id').eq('id', user.id).single()
  if (!profile || profile.role !== 'teacher') return null
  return profile.id
}

// GET /api/exams?classId=xxx
// 해당 반의 시험 목록 조회
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const teacherId = await verifyTeacher(db, token)
  if (!teacherId) return NextResponse.json({ error: '선생님 계정만 접근할 수 있어요.' }, { status: 403 })

  const classId = req.nextUrl.searchParams.get('classId')
  if (!classId) return NextResponse.json({ error: 'classId가 필요해요.' }, { status: 400 })

  const { data: exams, error } = await db
    .from('exams')
    .select('id, title, exam_type, start_at, end_at, status, answer_reveal, created_at')
    .eq('class_id', classId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ exams: exams ?? [] })
}

// POST /api/exams
// 시험 생성 (수동 or 자동)
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const teacherId = await verifyTeacher(db, token)
  if (!teacherId) return NextResponse.json({ error: '선생님 계정만 접근할 수 있어요.' }, { status: 403 })

  const body = await req.json()
  const { classId, title, examType, startAt, endAt, answerReveal, questions, maxScore, noDeadline } = body

  if (!classId || !title?.trim())
    return NextResponse.json({ error: '반과 시험 제목은 필수예요.' }, { status: 400 })

  // 마감 시간이 현재보다 이전이면 거부
  if (endAt && new Date(endAt) <= new Date())
    return NextResponse.json({ error: '마감 시간은 현재 시각 이후로 설정해 주세요.' }, { status: 400 })

  // 시험 생성
  const { data: exam, error: examError } = await db.from('exams').insert({
    class_id: classId,
    title: title.trim(),
    exam_type: examType ?? 'manual',
    start_at: examType === 'auto' ? null : (startAt ?? null),
    end_at: endAt ?? null,
    status: examType === 'manual' ? 'closed' : 'scheduled',
    answer_reveal: answerReveal ?? 'after_close',
    created_by: teacherId,
    max_score: (examType === 'manual' && maxScore != null) ? Number(maxScore) : null,
    no_deadline: examType === 'auto' ? (noDeadline ?? false) : false,
  }).select('id').single()

  if (examError || !exam)
    return NextResponse.json({ error: examError?.message ?? '시험 생성 실패' }, { status: 400 })

  // 자동 채점 시험이면 문제도 같이 저장
  if (examType === 'auto' && questions?.length) {
    for (const q of questions) {
      const { data: question, error: qError } = await db.from('exam_questions').insert({
        exam_id: exam.id,
        order_num: q.orderNum,
        question_text: q.questionText ?? null,
        question_type: q.questionType, // 'multiple_choice' | 'short_answer'
        score: q.score,
      }).select('id').single()

      if (qError || !question) continue

      // 객관식 선택지
      if (q.questionType === 'multiple_choice' && q.choices?.length) {
        await db.from('exam_choices').insert(
          q.choices.map((c: { num: number; text: string }) => ({
            question_id: question.id,
            choice_num: c.num,
            choice_text: c.text ?? null,
          }))
        )
      }

      // 정답 (주관식은 여러 개)
      if (q.answers?.length) {
        await db.from('exam_correct_answers').insert(
          q.answers.map((a: string, idx: number) => ({
            question_id: question.id,
            answer_text: a,
            order_num: idx + 1,
          }))
        )
      }
    }
  }

  return NextResponse.json({ examId: exam.id })
}
