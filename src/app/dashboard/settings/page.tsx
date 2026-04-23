'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatPhone } from '@/lib/auth'
import {
  Building2, User, Users, Check, X, Plus,
  Eye, EyeOff, Crown, Shield, Loader2,
} from 'lucide-react'

type Tab = 'academy' | 'profile' | 'team'
type TeamMember = {
  id: string
  teacher_id: string
  role: 'owner' | 'staff'
  name: string
  phone: string
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('academy')
  const [myId, setMyId] = useState('')
  const [myRole, setMyRole] = useState<'owner' | 'staff'>('staff')
  const [academyId, setAcademyId] = useState('')
  const [loading, setLoading] = useState(true)

  // 학원 정보
  const [academyName, setAcademyName] = useState('')
  const [savingAcademy, setSavingAcademy] = useState(false)
  const [academySaved, setAcademySaved] = useState(false)

  // 내 정보
  const [myName, setMyName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)

  // 비밀번호 변경
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [savingPw, setSavingPw] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwSaved, setPwSaved] = useState(false)

  // 팀 관리
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newPwTeacher, setNewPwTeacher] = useState('')
  const [confirmPwTeacher, setConfirmPwTeacher] = useState('')
  const [addingTeacher, setAddingTeacher] = useState(false)
  const [addError, setAddError] = useState('')
  const [teamError, setTeamError] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMyId(user.id)

    const [{ data: profile }, { data: membership }] = await Promise.all([
      supabase.from('profiles').select('name').eq('id', user.id).single(),
      supabase.from('academy_teachers')
        .select('academy_id, role, academies(id, name)')
        .eq('teacher_id', user.id)
        .single(),
    ])

    if (profile) setMyName(profile.name)
    if (membership) {
      const ac = (membership as any).academies
      setAcademyId(membership.academy_id)
      setMyRole(membership.role as 'owner' | 'staff')
      if (ac) setAcademyName(ac.name)
      await loadTeam(membership.academy_id)
    }
    setLoading(false)
  }

  async function loadTeam(acadId: string) {
    const { data } = await supabase
      .from('academy_teachers')
      .select('id, teacher_id, role, profiles(name, phone)')
      .eq('academy_id', acadId)
      .order('role')

    const members: TeamMember[] = (data ?? []).map((m: any) => ({
      id: m.id,
      teacher_id: m.teacher_id,
      role: m.role,
      name: m.profiles?.name ?? '',
      phone: m.profiles?.phone ?? '',
    }))
    // owner 먼저 정렬
    members.sort((a, b) => (a.role === 'owner' ? -1 : 1) - (b.role === 'owner' ? -1 : 1))
    setTeamMembers(members)
  }

  async function saveAcademyName() {
    if (!academyName.trim()) return
    setSavingAcademy(true)
    await supabase.from('academies').update({ name: academyName.trim() }).eq('id', academyId)
    setSavingAcademy(false)
    setAcademySaved(true)
    setTimeout(() => setAcademySaved(false), 2000)
  }

  async function saveMyName() {
    if (!myName.trim()) return
    setSavingName(true)
    await supabase.from('profiles').update({ name: myName.trim() }).eq('id', myId)
    setSavingName(false)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  async function changePassword() {
    setPwError('')
    if (newPw.length < 6) { setPwError('비밀번호는 6자 이상이어야 해요.'); return }
    if (newPw !== confirmPw) { setPwError('비밀번호가 일치하지 않아요.'); return }
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setSavingPw(false)
    if (error) { setPwError(error.message); return }
    setPwSaved(true)
    setNewPw('')
    setConfirmPw('')
    setTimeout(() => setPwSaved(false), 3000)
  }

  async function addTeacher(e: React.FormEvent) {
    e.preventDefault()
    setAddError('')
    if (newPwTeacher.length < 6) { setAddError('비밀번호는 6자 이상이어야 해요.'); return }
    if (newPwTeacher !== confirmPwTeacher) { setAddError('비밀번호가 일치하지 않아요.'); return }
    setAddingTeacher(true)

    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/create-teacher', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        name: newName,
        phone: newPhone.replace(/\D/g, ''),
        password: newPwTeacher,
      }),
    })
    const result = await res.json()
    setAddingTeacher(false)

    if (!res.ok) { setAddError(result.error); return }

    setNewName('')
    setNewPhone('')
    setNewPwTeacher('')
    setConfirmPwTeacher('')
    setShowAddForm(false)
    await loadTeam(academyId)
  }

  async function removeTeacher(member: TeamMember) {
    if (member.teacher_id === myId) return
    if (!confirm(`${member.name} 선생님을 팀에서 제거할까요?\n로그인은 불가능해지지만 계정은 유지돼요.`)) return
    setTeamError('')
    const { error } = await supabase
      .from('academy_teachers')
      .delete()
      .eq('id', member.id)
    if (error) { setTeamError(error.message); return }
    await loadTeam(academyId)
  }

  if (loading) return <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>

  const TABS: { key: Tab; label: string; Icon: React.ElementType }[] = [
    { key: 'academy', label: '학원 정보', Icon: Building2 },
    { key: 'profile', label: '내 정보', Icon: User },
    { key: 'team', label: '팀 관리', Icon: Users },
  ]

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold text-slate-800">설정</h1>

      {/* 탭 */}
      <div className="flex bg-slate-100 rounded-xl p-1">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* ── 학원 정보 탭 ── */}
      {tab === 'academy' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h2 className="font-bold text-slate-800">학원 정보</h2>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">학원 이름</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={academyName}
                onChange={e => setAcademyName(e.target.value)}
                disabled={myRole !== 'owner'}
                className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
              />
              {myRole === 'owner' && (
                <button
                  onClick={saveAcademyName}
                  disabled={savingAcademy}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center w-16 ${
                    academySaved
                      ? 'bg-emerald-500 text-white'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {academySaved
                    ? <Check size={16} />
                    : savingAcademy
                    ? <Loader2 size={16} className="animate-spin" />
                    : '저장'}
                </button>
              )}
            </div>
            {myRole !== 'owner' && (
              <p className="text-xs text-slate-400 mt-1.5">학원 정보는 원장만 수정할 수 있어요</p>
            )}
          </div>
        </div>
      )}

      {/* ── 내 정보 탭 ── */}
      {tab === 'profile' && (
        <div className="space-y-4">
          {/* 이름 변경 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <h2 className="font-bold text-slate-800">이름 변경</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={myName}
                onChange={e => setMyName(e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={saveMyName}
                disabled={savingName}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center w-16 ${
                  nameSaved ? 'bg-emerald-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {nameSaved
                  ? <Check size={16} />
                  : savingName
                  ? <Loader2 size={16} className="animate-spin" />
                  : '저장'}
              </button>
            </div>
          </div>

          {/* 비밀번호 변경 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="font-bold text-slate-800">비밀번호 변경</h2>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">새 비밀번호</label>
              <div className="relative">
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="6자 이상"
                  className="w-full px-3 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showNewPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">새 비밀번호 확인</label>
              <div className="relative">
                <input
                  type={showConfirmPw ? 'text' : 'password'}
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="비밀번호 재입력"
                  className="w-full px-3 py-2.5 pr-10 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showConfirmPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            {pwError && <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">{pwError}</p>}
            {pwSaved && <p className="text-emerald-600 text-sm bg-emerald-50 px-3 py-2 rounded-lg flex items-center gap-1.5"><Check size={14} /> 비밀번호가 변경됐어요</p>}
            <button
              onClick={changePassword}
              disabled={savingPw || !newPw || !confirmPw}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40 text-sm"
            >
              {savingPw ? '변경 중...' : '비밀번호 변경'}
            </button>
          </div>
        </div>
      )}

      {/* ── 팀 관리 탭 ── */}
      {tab === 'team' && (
        <div className="space-y-4">
          {/* 팀 목록 */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-800">팀 선생님</h2>
                <p className="text-xs text-slate-400 mt-0.5">총 {teamMembers.length}명</p>
              </div>
              {myRole === 'owner' && !showAddForm && (
                <button
                  onClick={() => { setShowAddForm(true); setAddError('') }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
                >
                  <Plus size={14} /> 선생님 추가
                </button>
              )}
            </div>

            {teamError && (
              <div className="mx-4 mt-3 text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">{teamError}</div>
            )}

            <div className="divide-y divide-slate-50">
              {teamMembers.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                    m.role === 'owner' ? 'bg-amber-100' : 'bg-blue-100'
                  }`}>
                    {m.role === 'owner'
                      ? <Crown size={15} className="text-amber-600" />
                      : <Shield size={15} className="text-blue-600" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-800">{m.name}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        m.role === 'owner'
                          ? 'bg-amber-50 text-amber-600'
                          : 'bg-blue-50 text-blue-600'
                      }`}>
                        {m.role === 'owner' ? '원장' : '교사'}
                      </span>
                      {m.teacher_id === myId && (
                        <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full">나</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{formatPhone(m.phone)}</p>
                  </div>
                  {myRole === 'owner' && m.teacher_id !== myId && (
                    <button
                      onClick={() => removeTeacher(m)}
                      className="p-1.5 text-slate-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                      title="팀에서 제거"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 선생님 추가 폼 */}
          {myRole === 'owner' && showAddForm && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-800">새 선생님 추가</h2>
                <button
                  onClick={() => { setShowAddForm(false); setAddError('') }}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={addTeacher} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">이름 *</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    required
                    placeholder="선생님 이름"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">전화번호 (로그인 ID) *</label>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={e => setNewPhone(formatPhone(e.target.value))}
                    required
                    placeholder="010-0000-0000"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">초기 비밀번호 *</label>
                  <input
                    type="password"
                    value={newPwTeacher}
                    onChange={e => setNewPwTeacher(e.target.value)}
                    required
                    placeholder="6자 이상"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">비밀번호 확인 *</label>
                  <input
                    type="password"
                    value={confirmPwTeacher}
                    onChange={e => setConfirmPwTeacher(e.target.value)}
                    required
                    placeholder="비밀번호 재입력"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {addError && (
                  <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">{addError}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => { setShowAddForm(false); setAddError('') }}
                    className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 text-sm transition-colors"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={addingTeacher}
                    className="flex-1 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 text-sm transition-colors disabled:opacity-50"
                  >
                    {addingTeacher ? '추가 중...' : '추가'}
                  </button>
                </div>
              </form>
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <p className="text-xs text-amber-700 leading-relaxed">
                  💡 추가 후 선생님에게 <span className="font-semibold">전화번호와 초기 비밀번호</span>를 알려주세요.<br />
                  선생님은 로그인 후 설정에서 비밀번호를 변경할 수 있어요.
                </p>
              </div>
            </div>
          )}

          {myRole !== 'owner' && (
            <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-500 text-center">
              팀 관리(선생님 추가·제거)는 원장만 가능해요
            </div>
          )}
        </div>
      )}
    </div>
  )
}
