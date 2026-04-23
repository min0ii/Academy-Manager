'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GraduationCap, Users, BookOpen } from 'lucide-react'
import { signUp, formatPhone } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

type Role = 'teacher' | 'student' | 'parent'

const roles = [
  {
    key: 'teacher' as Role,
    label: '선생님 / 관리자',
    desc: '학원을 관리하고 학생을 지도해요',
    icon: GraduationCap,
    color: 'blue',
  },
  {
    key: 'student' as Role,
    label: '학생',
    desc: '내 성적과 출석을 확인해요',
    icon: BookOpen,
    color: 'emerald',
  },
  {
    key: 'parent' as Role,
    label: '학부모',
    desc: '자녀의 학습 현황을 확인해요',
    icon: Users,
    color: 'violet',
  },
]

const colorMap = {
  blue: {
    border: 'border-blue-500 bg-blue-50',
    icon: 'bg-blue-100 text-blue-600',
    radio: 'text-blue-600',
  },
  emerald: {
    border: 'border-emerald-500 bg-emerald-50',
    icon: 'bg-emerald-100 text-emerald-600',
    radio: 'text-emerald-600',
  },
  violet: {
    border: 'border-violet-500 bg-violet-50',
    icon: 'bg-violet-100 text-violet-600',
    radio: 'text-violet-600',
  },
}

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState<'role' | 'info'>('role')
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleRoleNext() {
    if (!selectedRole) return
    setStep('info')
  }

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

    setLoading(true)

    // 학생·학부모: 사전 등록된 번호인지 확인
    if (selectedRole !== 'teacher') {
      const digits = phone.replace(/\D/g, '')
      const { data: isRegistered } = await supabase
        .rpc('check_phone_registered', { p_phone: digits, p_role: selectedRole })

      if (!isRegistered) {
        const msg = selectedRole === 'parent'
          ? '등록되지 않은 학부모 전화번호예요. 선생님께 먼저 등록을 요청해주세요.'
          : '등록되지 않은 전화번호예요. 선생님께 먼저 등록을 요청해주세요.'
        setError(msg)
        setLoading(false)
        return
      }
    }

    const { error: authError } = await signUp(phone, password, name, selectedRole!)
    if (authError) {
      if (authError.message.includes('already registered')) {
        setError('이미 가입된 전화번호예요. 로그인해주세요.')
      } else {
        setError(`오류: ${authError.message}`)
      }
      setLoading(false)
      return
    }

    if (selectedRole === 'teacher') {
      router.push('/onboarding')
    } else if (selectedRole === 'student') {
      router.push('/student')
    } else {
      router.push('/parent')
    }
  }

  if (step === 'role') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-slate-800">회원가입</h1>
            <p className="text-slate-500 text-sm mt-1">어떤 역할로 사용하시나요?</p>
          </div>

          <div className="space-y-3">
            {roles.map(role => {
              const Icon = role.icon
              const colors = colorMap[role.color as keyof typeof colorMap]
              const isSelected = selectedRole === role.key
              return (
                <button
                  key={role.key}
                  onClick={() => setSelectedRole(role.key)}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                    isSelected
                      ? colors.border
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className={`p-2.5 rounded-xl ${isSelected ? colors.icon : 'bg-slate-100 text-slate-500'}`}>
                    <Icon size={22} />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{role.label}</p>
                    <p className="text-sm text-slate-500">{role.desc}</p>
                  </div>
                </button>
              )
            })}
          </div>

          <button
            onClick={handleRoleNext}
            disabled={!selectedRole}
            className="w-full mt-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            다음
          </button>

          <p className="text-center text-sm text-slate-500 mt-4">
            이미 계정이 있으신가요?{' '}
            <Link href="/login" className="text-blue-600 font-medium hover:underline">
              로그인
            </Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <button
            onClick={() => setStep('role')}
            className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-flex items-center gap-1"
          >
            ← 역할 다시 선택
          </button>
          <h1 className="text-2xl font-bold text-slate-800">정보 입력</h1>
          <p className="text-slate-500 text-sm mt-1">
            {selectedRole === 'teacher' ? '선생님' : selectedRole === 'student' ? '학생' : '학부모'} 계정을 만들게요
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <form onSubmit={handleSignup} className="space-y-4">
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

            {error && (
              <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '가입 중...' : '가입하기'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
