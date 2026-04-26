'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  GraduationCap, LogOut, KeyRound, Eye, EyeOff, X, Check,
} from 'lucide-react'

export default function StudentPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [studentName, setStudentName] = useState('')

  // 비밀번호 변경 안내
  const [mustChangePw, setMustChangePw] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwDone, setPwDone] = useState(false)

  useEffect(() => { loadBase() }, [])

  async function loadBase() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, role, must_change_password')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'student') {
      if (profile?.role === 'teacher') router.replace('/dashboard')
      else if (profile?.role === 'parent') router.replace('/parent')
      else router.replace('/login')
      return
    }

    setStudentName(profile.name)
    if (profile.must_change_password) {
      setMustChangePw(true)
      setShowPwModal(true)
    }

    setLoading(false)
  }

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault()
    setPwError('')
    if (newPw.length < 6) { setPwError('비밀번호는 6자 이상이어야 해요.'); return }
    if (newPw !== confirmPw) { setPwError('비밀번호가 일치하지 않아요.'); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) { setPwError(error.message); setPwSaving(false); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await supabase.from('profiles').update({ must_change_password: false }).eq('id', user.id)
    setPwSaving(false)
    setPwDone(true)
    setMustChangePw(false)
    setTimeout(() => { setShowPwModal(false); setPwDone(false); setNewPw(''); setConfirmPw('') }, 1800)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <GraduationCap size={15} className="text-white" />
          </div>
          <span className="text-sm font-bold text-slate-800">학생 포털</span>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 text-sm transition-colors"
        >
          <LogOut size={15} />
          <span className="hidden sm:block">로그아웃</span>
        </button>
      </header>

      {/* 비밀번호 변경 배너 */}
      {mustChangePw && !showPwModal && (
        <div
          onClick={() => setShowPwModal(true)}
          className="bg-amber-500 text-white text-xs text-center py-2.5 px-4 font-medium cursor-pointer hover:bg-amber-600 transition-colors"
        >
          🔒 초기 비밀번호를 사용 중이에요. 탭하여 비밀번호를 변경해주세요.
        </div>
      )}

      {/* 콘텐츠 */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-5 space-y-4">
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-5 text-white">
          <p className="text-blue-200 text-sm">안녕하세요 👋</p>
          <h1 className="text-xl font-bold mt-1">{studentName}님</h1>
          <p className="text-blue-200 text-xs mt-2">학생 포털이 곧 열릴 예정이에요!</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-2">
          <p className="text-2xl">🚧</p>
          <p className="font-bold text-slate-700">준비 중이에요</p>
          <p className="text-sm text-slate-400">출석, 성적, 클리닉 기록을 곧 확인할 수 있어요.</p>
        </div>

        <button
          onClick={() => setShowPwModal(true)}
          className="w-full flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <KeyRound size={15} className="text-slate-400" />
          비밀번호 변경
        </button>
      </main>

      {/* 비밀번호 변경 모달 */}
      {showPwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound size={18} className="text-amber-500" />
                <h2 className="font-bold text-slate-800">비밀번호 변경</h2>
              </div>
              {!mustChangePw && (
                <button onClick={() => setShowPwModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={18} />
                </button>
              )}
            </div>

            {pwDone ? (
              <div className="p-8 flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Check size={28} className="text-emerald-600" />
                </div>
                <p className="font-bold text-slate-800">변경 완료!</p>
                <p className="text-xs text-slate-400">새 비밀번호로 로그인할 수 있어요.</p>
              </div>
            ) : (
              <form onSubmit={handleChangePw} className="p-5 space-y-4">
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-amber-700 leading-relaxed">
                    현재 <span className="font-semibold">초기 비밀번호</span>(전화번호 뒤 8자리)를 사용 중이에요.<br />
                    보안을 위해 새 비밀번호로 변경해주세요.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">새 비밀번호</label>
                  <div className="relative">
                    <input
                      type={showNewPw ? 'text' : 'password'}
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      placeholder="6자 이상"
                      required
                      className="w-full px-3 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button type="button" onClick={() => setShowNewPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      {showNewPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">비밀번호 확인</label>
                  <div className="relative">
                    <input
                      type={showConfirmPw ? 'text' : 'password'}
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="비밀번호 재입력"
                      required
                      className="w-full px-3 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <button type="button" onClick={() => setShowConfirmPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                      {showConfirmPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                {pwError && <p className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{pwError}</p>}
                <div className="flex gap-2 pt-1">
                  {!mustChangePw && (
                    <button type="button" onClick={() => setShowPwModal(false)}
                      className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl text-sm">
                      취소
                    </button>
                  )}
                  <button type="submit" disabled={pwSaving}
                    className="flex-1 py-2.5 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors text-sm disabled:opacity-50">
                    {pwSaving ? '변경 중...' : '변경하기'}
                  </button>
                </div>
                {mustChangePw && (
                  <p className="text-xs text-slate-400 text-center">
                    비밀번호를 변경해야 이용할 수 있어요
                  </p>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
