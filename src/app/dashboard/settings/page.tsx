'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Building2, User, Check, X,
  Eye, EyeOff, Loader2, Camera,
} from 'lucide-react'

type Tab = 'academy' | 'profile'
type Title = '원장' | '관리자' | '강사' | '조교'

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('academy')
  const [myId, setMyId] = useState('')
  const [myRole, setMyRole] = useState<'owner' | 'staff'>('staff')
  const [myTitle, setMyTitle] = useState<Title>('강사')
  const [academyId, setAcademyId] = useState('')
  const [loading, setLoading] = useState(true)

  // 학원 정보
  const [academyName, setAcademyName] = useState('')
  const [academyLogoUrl, setAcademyLogoUrl] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [savingLogo, setSavingLogo] = useState(false)
  const [logoSaved, setLogoSaved] = useState(false)
  const [savingAcademy, setSavingAcademy] = useState(false)
  const [academySaved, setAcademySaved] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return
    setMyId(user.id)

    const [{ data: profile }, { data: membership }] = await Promise.all([
      supabase.from('profiles').select('name').eq('id', user.id).single(),
      supabase.from('academy_teachers')
        .select('academy_id, role, academies(id, name, logo_url)')
        .eq('teacher_id', user.id)
        .single(),
    ])

    if (profile) setMyName(profile.name)
    if (membership) {
      const ac = (membership as any).academies
      setAcademyId(membership.academy_id)
      setMyRole(membership.role as 'owner' | 'staff')
      setMyTitle((membership as any).title ?? '강사')
      if (ac) {
        setAcademyName(ac.name)
        setAcademyLogoUrl(ac.logo_url ?? null)
      }
    }
    setLoading(false)
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  async function saveLogo() {
    if (!logoFile || !academyId) return
    setSavingLogo(true)
    const ext = logoFile.name.split('.').pop()
    const path = `${academyId}-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('academy-logos')
      .upload(path, logoFile, { upsert: true })
    if (uploadError) { setSavingLogo(false); return }
    const { data: urlData } = supabase.storage.from('academy-logos').getPublicUrl(path)
    const newUrl = urlData.publicUrl
    await supabase.from('academies').update({ logo_url: newUrl }).eq('id', academyId)
    setAcademyLogoUrl(newUrl)
    setLogoFile(null)
    setLogoPreview(null)
    setSavingLogo(false)
    setLogoSaved(true)
    setTimeout(() => setLogoSaved(false), 2000)
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

  // 원장 또는 관리자 직급이면 전체 권한
  // 조교만 제한, 원장·관리자·강사 모두 동등한 관리자 권한
  const isAdmin = myTitle !== '조교'

  if (loading) return <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>

  const TABS: { key: Tab; label: string; Icon: React.ElementType }[] = [
    { key: 'academy', label: '학원 정보', Icon: Building2 },
    { key: 'profile', label: '내 정보', Icon: User },
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
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
          <h2 className="font-bold text-slate-800">학원 정보</h2>

          {/* 로고 */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">학원 로고</label>
            <div className="flex items-center gap-4">
              {/* 미리보기 */}
              <div className="relative flex-shrink-0">
                {logoPreview || academyLogoUrl ? (
                  <img
                    src={logoPreview ?? academyLogoUrl!}
                    alt="학원 로고"
                    className="w-20 h-20 rounded-2xl object-cover border border-slate-200"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-blue-100 flex items-center justify-center border border-slate-200">
                    <span className="text-blue-600 font-bold text-2xl">{academyName[0] ?? '학'}</span>
                  </div>
                )}
                {isAdmin && (
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="absolute -bottom-1.5 -right-1.5 w-7 h-7 bg-slate-700 text-white rounded-full flex items-center justify-center hover:bg-slate-800 transition-colors shadow"
                  >
                    <Camera size={13} />
                  </button>
                )}
              </div>
              {/* 버튼 영역 */}
              <div className="space-y-2 flex-1">
                {isAdmin && (
                  <>
                    <button
                      onClick={() => logoInputRef.current?.click()}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors text-left"
                    >
                      {logoPreview ? '다른 사진으로 변경' : '사진 선택'}
                    </button>
                    {logoPreview && (
                      <button
                        onClick={saveLogo}
                        disabled={savingLogo}
                        className={`w-full py-2 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                          logoSaved
                            ? 'bg-emerald-500 text-white'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        {logoSaved
                          ? <><Check size={14} /> 저장됨</>
                          : savingLogo
                          ? <><Loader2 size={14} className="animate-spin" /> 업로드 중...</>
                          : '저장'}
                      </button>
                    )}
                  </>
                )}
                <p className="text-xs text-slate-400">JPG, PNG 권장 · 정사각형 이미지가 가장 잘 보여요</p>
              </div>
            </div>
            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
          </div>

          {/* 학원 이름 */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">학원 이름</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={academyName}
                onChange={e => setAcademyName(e.target.value)}
                disabled={!isAdmin}
                className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
              />
              {isAdmin && (
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
            {!isAdmin && (
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

    </div>
  )
}
