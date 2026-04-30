'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signIn, getProfile, formatPhone } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: authError } = await signIn(phone, password)
    if (authError) {
      setError('전화번호 또는 비밀번호가 올바르지 않아요.')
      setLoading(false)
      return
    }

    const profile = await getProfile()
    if (!profile) {
      setError('프로필 정보를 불러올 수 없어요.')
      setLoading(false)
      return
    }

    if (profile.role === 'teacher') router.push('/dashboard')
    else if (profile.role === 'student') router.push('/student')
    else router.push('/parent')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        {/* 로고 영역 */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-800">학원 관리 시스템</h1>
          <p className="text-slate-500 text-sm mt-1">로그인하여 시작하세요</p>
        </div>

        {/* 로그인 폼 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                전화번호
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(formatPhone(e.target.value))}
                placeholder="010-0000-0000"
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>
        </div>

        {/* 비밀번호 찾기 */}
        <p className="text-center text-sm mt-3">
          <Link href="/forgot-password" className="text-slate-400 hover:text-blue-600 transition-colors">
            비밀번호를 잊으셨나요?
          </Link>
        </p>

        {/* 회원가입 링크 */}
        <p className="text-center text-sm text-slate-500 mt-2">
          계정이 없으신가요?{' '}
          <Link href="/signup" className="text-blue-600 font-medium hover:underline">
            회원가입
          </Link>
        </p>
      </div>
    </div>
  )
}
