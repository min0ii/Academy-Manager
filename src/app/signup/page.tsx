'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GraduationCap, BookOpen, Users, ShieldQuestion } from 'lucide-react'
import { signUp, formatPhone } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [securityQuestion, setSecurityQuestion] = useState('')
  const [securityAnswer, setSecurityAnswer] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않아요.')
      return
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 해요.')
      return
    }
    if (!securityQuestion.trim()) {
      setError('비밀번호 찾기 질문을 입력해주세요.')
      return
    }
    if (!securityAnswer.trim()) {
      setError('비밀번호 찾기 답변을 입력해주세요.')
      return
    }

    setLoading(true)
    const { error: authError } = await signUp(phone, password, name, 'teacher')
    if (authError) {
      if (authError.message.includes('already registered')) {
        setError('이미 가입된 전화번호예요. 로그인해주세요.')
      } else {
        setError(`오류: ${authError.message}`)
      }
      setLoading(false)
      return
    }

    // 가입 직후 세션 토큰으로 보안 질문 저장
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      await fetch('/api/security-question', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          question: securityQuestion.trim(),
          answer: securityAnswer.trim(),
        }),
      })
    }

    router.push('/onboarding')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm space-y-5">

        {/* 헤더 */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-100 rounded-2xl mb-4">
            <GraduationCap size={28} className="text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">원장 계정 만들기</h1>
          <p className="text-slate-500 text-sm mt-1">학원을 개설하고 팀을 구성해요</p>
        </div>

        {/* 가입 폼 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <form onSubmit={handleSignup} className="space-y-4">
            {/* 이름 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">이름</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="홍길동"
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* 전화번호 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">전화번호</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(formatPhone(e.target.value))}
                placeholder="010-0000-0000"
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* 비밀번호 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="6자 이상"
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">비밀번호 확인</label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={e => setPasswordConfirm(e.target.value)}
                placeholder="비밀번호 재입력"
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* 구분선 + 보안 질문 섹션 */}
            <div className="pt-1">
              <div className="flex items-center gap-2 mb-3">
                <ShieldQuestion size={15} className="text-blue-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-slate-700">비밀번호 찾기 질문</span>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-3">
                <p className="text-xs text-amber-700 leading-relaxed">
                  ⚠️ 이 질문과 답변을 잊으면 <span className="font-bold">비밀번호를 초기화할 수 없어요.</span><br />
                  가장 잘 기억할 수 있는 것으로 설정해주세요.
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">질문</label>
                  <input
                    type="text"
                    value={securityQuestion}
                    onChange={e => setSecurityQuestion(e.target.value)}
                    placeholder="예: 내 첫 번째 반려동물 이름은?"
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">답변</label>
                  <input
                    type="text"
                    value={securityAnswer}
                    onChange={e => setSecurityAnswer(e.target.value)}
                    placeholder="가장 잘 기억할 수 있는 답변을 쓰세요"
                    required
                    autoComplete="off"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">대·소문자 구분 없이 입력해도 돼요</p>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '가입 중...' : '학원 개설하기'}
            </button>
          </form>
        </div>

        {/* 학생·학부모 안내 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">학생 · 학부모 계정 안내</p>
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-emerald-50 rounded-lg flex-shrink-0 mt-0.5">
                <BookOpen size={14} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">학생</p>
                <p className="text-xs text-slate-400 leading-relaxed">별도 가입 없이 학원 선생님이 계정을 만들어 드려요. 소속 학원에 문의해주세요.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="p-1.5 bg-violet-50 rounded-lg flex-shrink-0 mt-0.5">
                <Users size={14} className="text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">학부모</p>
                <p className="text-xs text-slate-400 leading-relaxed">자녀가 다니는 학원 선생님께 계정 등록을 요청해주세요.</p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-center text-sm text-slate-500">
          이미 계정이 있으신가요?{' '}
          <Link href="/login" className="text-blue-600 font-medium hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  )
}
