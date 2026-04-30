'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { KeyRound, Eye, EyeOff, Check, ArrowLeft } from 'lucide-react'
import { formatPhone } from '@/lib/auth'

type Step = 'phone' | 'question' | 'password' | 'done'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('phone')

  const [phone, setPhone] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const steps: Step[] = ['phone', 'question', 'password']
  const stepIdx = steps.indexOf(step)

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await fetch(`/api/security-question?phone=${phone.replace(/\D/g, '')}`)
    const json = await res.json()
    setLoading(false)

    if (!res.ok) { setError(json.error ?? '오류가 발생했어요.'); return }
    if (!json.question) {
      setError('비밀번호 찾기 질문이 아직 설정되지 않았어요.\n로그인 후 설정 탭에서 먼저 등록해주세요.')
      return
    }
    setQuestion(json.question)
    setStep('question')
  }

  function handleAnswerSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!answer.trim()) { setError('답변을 입력해주세요.'); return }
    setStep('password')
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPw.length < 6) { setError('비밀번호는 6자 이상이어야 해요.'); return }
    if (newPw !== confirmPw) { setError('비밀번호가 일치하지 않아요.'); return }
    setLoading(true)

    const res = await fetch('/api/security-question', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, answer, newPassword: newPw }),
    })
    const json = await res.json()
    setLoading(false)

    if (!res.ok) {
      // 답변이 틀리면 질문 단계로 되돌아감
      if (json.error?.includes('답변')) {
        setStep('question')
        setAnswer('')
      }
      setError(json.error ?? '오류가 발생했어요.')
      return
    }
    setStep('done')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-100 rounded-2xl mb-4">
            <KeyRound size={26} className="text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">비밀번호 찾기</h1>
          <p className="text-slate-500 text-sm mt-1">
            {step === 'phone' && '가입한 전화번호를 입력해주세요'}
            {step === 'question' && '보안 질문에 답해주세요'}
            {step === 'password' && '새 비밀번호를 설정해주세요'}
            {step === 'done' && '비밀번호가 성공적으로 변경됐어요'}
          </p>
        </div>

        {step === 'done' ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check size={30} className="text-emerald-600" />
            </div>
            <div className="text-center">
              <p className="font-bold text-slate-800 text-lg">변경 완료!</p>
              <p className="text-sm text-slate-500 mt-1">새 비밀번호로 로그인할 수 있어요.</p>
            </div>
            <button
              onClick={() => router.push('/login')}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors"
            >
              로그인하러 가기
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
            {/* 진행 표시 */}
            <div className="flex justify-center gap-2 mb-2">
              {steps.map((s, i) => (
                <div
                  key={s}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i <= stepIdx ? 'bg-blue-500' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>

            {/* STEP 1: 전화번호 */}
            {step === 'phone' && (
              <form onSubmit={handlePhoneSubmit} className="space-y-4">
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
                {error && (
                  <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl whitespace-pre-line">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {loading ? '확인 중...' : '다음'}
                </button>
              </form>
            )}

            {/* STEP 2: 보안 질문 */}
            {step === 'question' && (
              <form onSubmit={handleAnswerSubmit} className="space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-blue-500 font-semibold mb-1.5">보안 질문</p>
                  <p className="text-sm text-slate-800 font-medium leading-relaxed">{question}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">답변</label>
                  <input
                    type="text"
                    value={answer}
                    onChange={e => setAnswer(e.target.value)}
                    placeholder="설정한 답변을 입력하세요"
                    required
                    autoComplete="off"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">대·소문자 구분 없이 입력해도 돼요</p>
                </div>
                {error && (
                  <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{error}</p>
                )}
                <button
                  type="submit"
                  className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors"
                >
                  다음
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setError('') }}
                  className="w-full flex items-center justify-center gap-1.5 text-slate-400 text-sm hover:text-slate-600 transition-colors"
                >
                  <ArrowLeft size={13} /> 전화번호 다시 입력
                </button>
              </form>
            )}

            {/* STEP 3: 새 비밀번호 */}
            {step === 'password' && (
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">새 비밀번호</label>
                  <div className="relative">
                    <input
                      type={showNewPw ? 'text' : 'password'}
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      placeholder="6자 이상"
                      required
                      className="w-full px-4 py-3 pr-11 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">새 비밀번호 확인</label>
                  <div className="relative">
                    <input
                      type={showConfirmPw ? 'text' : 'password'}
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="비밀번호 재입력"
                      required
                      className="w-full px-4 py-3 pr-11 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                {error && (
                  <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {loading ? '변경 중...' : '비밀번호 변경'}
                </button>
              </form>
            )}
          </div>
        )}

        <p className="text-center text-sm text-slate-500 mt-5">
          <Link
            href="/login"
            className="text-blue-600 font-medium hover:underline inline-flex items-center gap-1"
          >
            <ArrowLeft size={13} /> 로그인으로 돌아가기
          </Link>
        </p>
      </div>
    </div>
  )
}
