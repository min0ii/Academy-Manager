import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function hashAnswer(answer: string) {
  return createHash('sha256').update(answer.trim().toLowerCase()).digest('hex')
}

// GET /api/security-question?phone=01012345678
// 비밀번호 찾기용: 전화번호로 보안 질문 조회 (인증 불필요)
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const phone = req.nextUrl.searchParams.get('phone')?.replace(/\D/g, '')
  if (!phone) return NextResponse.json({ error: '전화번호를 입력해주세요.' }, { status: 400 })

  const db = admin()
  const { data: profile } = await db
    .from('profiles')
    .select('security_question')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) return NextResponse.json({ error: '가입된 전화번호가 아니에요.' }, { status: 404 })

  return NextResponse.json({ question: profile.security_question ?? null })
}

// POST /api/security-question (인증 필요)
// Body: { question: string, answer: string }
// 보안 질문·답변 설정 또는 변경
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return NextResponse.json({ error: '인증 오류' }, { status: 401 })

  const body = await req.json()
  const question = body.question?.trim()
  const answer = body.answer?.trim()

  if (!question || !answer)
    return NextResponse.json({ error: '질문과 답변을 모두 입력해주세요.' }, { status: 400 })

  const hashedAnswer = hashAnswer(answer)

  const { error: updateError } = await db
    .from('profiles')
    .update({ security_question: question, security_answer: hashedAnswer })
    .eq('id', user.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 })

  return NextResponse.json({ success: true })
}

// PUT /api/security-question
// Body: { phone: string, answer: string, newPassword: string }
// 보안 질문 답변 검증 후 비밀번호 재설정 (인증 불필요)
export async function PUT(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const db = admin()
  const body = await req.json()
  const digits = body.phone?.replace(/\D/g, '')
  const answer = body.answer?.trim()
  const newPassword = body.newPassword

  if (!digits || !answer || !newPassword)
    return NextResponse.json({ error: '입력값이 올바르지 않아요.' }, { status: 400 })

  if (newPassword.length < 6)
    return NextResponse.json({ error: '비밀번호는 6자 이상이어야 해요.' }, { status: 400 })

  const { data: profile } = await db
    .from('profiles')
    .select('id, security_question, security_answer')
    .eq('phone', digits)
    .maybeSingle()

  if (!profile) return NextResponse.json({ error: '가입된 전화번호가 아니에요.' }, { status: 404 })

  if (!profile.security_question || !profile.security_answer)
    return NextResponse.json({ error: '비밀번호 찾기 질문이 설정되지 않았어요.' }, { status: 400 })

  const hashedAnswer = hashAnswer(answer)
  if (hashedAnswer !== profile.security_answer)
    return NextResponse.json({ error: '답변이 올바르지 않아요. 다시 확인해주세요.' }, { status: 400 })

  const { error: resetError } = await db.auth.admin.updateUserById(profile.id, {
    password: newPassword,
  })
  if (resetError) return NextResponse.json({ error: resetError.message }, { status: 400 })

  return NextResponse.json({ success: true })
}
