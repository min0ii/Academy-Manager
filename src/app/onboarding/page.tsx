'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, Plus, X, Upload, Building2, LayoutGrid, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getProfile } from '@/lib/auth'

type Step = 'academy' | 'classes' | 'students' | 'done'

const STEPS: { key: Step; label: string; icon: typeof Building2 }[] = [
  { key: 'academy', label: '학원 정보', icon: Building2 },
  { key: 'classes', label: '반 설정', icon: LayoutGrid },
  { key: 'students', label: '학생 명부', icon: Users },
]

export default function OnboardingPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('academy')

  useEffect(() => {
    getProfile().then(profile => {
      if (!profile) { router.push('/login'); return }
      if (profile.role !== 'teacher') { router.push('/login'); return }
    })
  }, [router])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 학원 정보
  const [academyName, setAcademyName] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [academyId, setAcademyId] = useState<string | null>(null)

  // 반 설정
  const [classes, setClasses] = useState<string[]>([''])

  // 학생 명부
  const [students, setStudents] = useState([
    { name: '', grade: '', phone: '', parentPhone: '', parentRelation: '' },
  ])

  // ── 로고 선택 ──
  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  // ── Step 1: 학원 정보 저장 ──
  async function handleAcademyNext(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const profile = await getProfile()
    if (!profile) { setError('로그인 정보를 불러올 수 없어요.'); setSaving(false); return }

    let logo_url: string | null = null

    if (logoFile) {
      const ext = logoFile.name.split('.').pop()
      const path = `${profile.id}-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('academy-logos')
        .upload(path, logoFile, { upsert: true })

      if (uploadError) {
        setError('로고 업로드 중 오류가 발생했어요.')
        setSaving(false)
        return
      }

      const { data: urlData } = supabase.storage.from('academy-logos').getPublicUrl(path)
      logo_url = urlData.publicUrl
    }

    const { data, error: dbError } = await supabase
      .from('academies')
      .insert({ name: academyName, teacher_id: profile.id, logo_url })
      .select()
      .single()

    if (dbError) { setError('학원 저장 중 오류가 발생했어요.'); setSaving(false); return }

    setAcademyId(data.id)
    setSaving(false)
    setStep('classes')
  }

  // ── Step 2: 반 저장 ──
  async function handleClassesNext(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const valid = classes.filter(c => c.trim())
    if (valid.length === 0) { setError('반 이름을 최소 하나 입력해주세요.'); setSaving(false); return }

    const { error: dbError } = await supabase
      .from('classes')
      .insert(valid.map(name => ({ name: name.trim(), academy_id: academyId })))

    if (dbError) { setError('반 저장 중 오류가 발생했어요.'); setSaving(false); return }

    setSaving(false)
    setStep('students')
  }

  // ── Step 3: 학생 명부 저장 ──
  async function handleStudentsNext(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const valid = students.filter(s => s.name.trim() && s.phone.trim())

    if (valid.length > 0) {
      const { error: dbError } = await supabase
        .from('students')
        .insert(valid.map(s => ({
          academy_id: academyId,
          name: s.name.trim(),
          grade: s.grade.trim() || '-',
          phone: s.phone.replace(/\D/g, ''),
          memo: null,
        })))

      if (dbError) { setError('학생 저장 중 오류가 발생했어요.'); setSaving(false); return }
    }

    setSaving(false)
    setStep('done')
  }

  // ── 반 추가/삭제 ──
  const addClass = () => setClasses([...classes, ''])
  const updateClass = (i: number, v: string) => setClasses(classes.map((c, idx) => idx === i ? v : c))
  const removeClass = (i: number) => classes.length > 1 && setClasses(classes.filter((_, idx) => idx !== i))

  // ── 학생 행 추가/삭제 ──
  const addStudent = () => setStudents([...students, { name: '', grade: '', phone: '', parentPhone: '', parentRelation: '' }])
  const updateStudent = (i: number, field: string, v: string) =>
    setStudents(students.map((s, idx) => idx === i ? { ...s, [field]: v } : s))
  const removeStudent = (i: number) => students.length > 1 && setStudents(students.filter((_, idx) => idx !== i))

  const currentStepIndex = STEPS.findIndex(s => s.key === step)

  // ── 완료 화면 ──
  if (step === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full mb-4">
            <CheckCircle className="text-emerald-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">설정 완료!</h1>
          <p className="text-slate-500 mb-6">이제 학원 관리를 시작할 수 있어요.<br />학생 명부는 대시보드에서 언제든 추가·수정할 수 있어요.</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors"
          >
            대시보드로 이동
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg mx-auto">

        {/* 상단 진행 표시 */}
        <div className="flex items-center justify-center gap-0 mb-10">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const isDone = i < currentStepIndex
            const isActive = i === currentStepIndex
            return (
              <div key={s.key} className="flex items-center">
                <div className="flex flex-col items-center gap-1.5">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    isDone ? 'bg-emerald-500 text-white' :
                    isActive ? 'bg-blue-600 text-white' :
                    'bg-slate-200 text-slate-400'
                  }`}>
                    {isDone ? <CheckCircle size={18} /> : <Icon size={18} />}
                  </div>
                  <span className={`text-xs font-medium ${isActive ? 'text-blue-600' : 'text-slate-400'}`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-16 h-0.5 mb-5 mx-1 ${i < currentStepIndex ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                )}
              </div>
            )
          })}
        </div>

        {/* ── Step 1: 학원 정보 ── */}
        {step === 'academy' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-xl font-bold text-slate-800 mb-1">학원 정보 입력</h2>
            <p className="text-sm text-slate-500 mb-6">학원 이름과 로고를 설정해주세요</p>
            <form onSubmit={handleAcademyNext} className="space-y-5">

              {/* 로고 업로드 */}
              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="relative w-24 h-24 rounded-2xl border-2 border-dashed border-slate-300 hover:border-blue-400 transition-colors flex items-center justify-center overflow-hidden bg-slate-50"
                >
                  {logoPreview ? (
                    <img src={logoPreview} alt="로고 미리보기" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-400">
                      <Upload size={20} />
                      <span className="text-xs">로고 추가</span>
                    </div>
                  )}
                </button>
                {logoPreview && (
                  <button
                    type="button"
                    onClick={() => { setLogoFile(null); setLogoPreview(null) }}
                    className="text-xs text-slate-400 hover:text-red-500"
                  >
                    로고 제거
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                <p className="text-xs text-slate-400">선택사항 · PNG, JPG 권장</p>
              </div>

              {/* 학원 이름 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">학원 이름 *</label>
                <input
                  type="text"
                  value={academyName}
                  onChange={e => setAcademyName(e.target.value)}
                  placeholder="예: 민준 수학학원"
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {error && <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? '저장 중...' : '다음 →'}
              </button>
            </form>
          </div>
        )}

        {/* ── Step 2: 반 설정 ── */}
        {step === 'classes' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-xl font-bold text-slate-800 mb-1">반 설정</h2>
            <p className="text-sm text-slate-500 mb-6">운영하는 반 이름을 입력해주세요 (나중에 추가·수정 가능)</p>
            <form onSubmit={handleClassesNext} className="space-y-4">
              <div className="space-y-2">
                {classes.map((cls, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={cls}
                      onChange={e => updateClass(i, e.target.value)}
                      placeholder={`예: 중3 심화반`}
                      className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {classes.length > 1 && (
                      <button type="button" onClick={() => removeClass(i)} className="p-3 text-slate-400 hover:text-red-500">
                        <X size={18} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addClass}
                className="w-full py-2.5 border-2 border-dashed border-slate-200 text-slate-500 rounded-xl hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
              >
                <Plus size={16} /> 반 추가
              </button>

              {error && <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? '저장 중...' : '다음 →'}
              </button>
            </form>
          </div>
        )}

        {/* ── Step 3: 학생 명부 ── */}
        {step === 'students' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-xl font-bold text-slate-800 mb-1">학생 명부</h2>
            <p className="text-sm text-slate-500 mb-6">지금 입력하거나 나중에 대시보드에서 추가할 수 있어요</p>
            <form onSubmit={handleStudentsNext} className="space-y-4">

              <div className="space-y-3">
                {students.map((s, i) => (
                  <div key={i} className="p-4 border border-slate-200 rounded-xl space-y-2 relative">
                    {students.length > 1 && (
                      <button type="button" onClick={() => removeStudent(i)} className="absolute top-3 right-3 text-slate-400 hover:text-red-500">
                        <X size={16} />
                      </button>
                    )}
                    <p className="text-xs font-semibold text-slate-500">학생 {i + 1}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={s.name}
                        onChange={e => updateStudent(i, 'name', e.target.value)}
                        placeholder="이름"
                        className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <input
                        type="text"
                        value={s.grade}
                        onChange={e => updateStudent(i, 'grade', e.target.value)}
                        placeholder="학년 (예: 중3)"
                        className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <input
                      type="tel"
                      value={s.phone}
                      onChange={e => updateStudent(i, 'phone', e.target.value)}
                      placeholder="학생 전화번호"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="tel"
                        value={s.parentPhone}
                        onChange={e => updateStudent(i, 'parentPhone', e.target.value)}
                        placeholder="학부모 전화번호"
                        className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <input
                        type="text"
                        value={s.parentRelation}
                        onChange={e => updateStudent(i, 'parentRelation', e.target.value)}
                        placeholder="관계 (예: 엄마)"
                        className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addStudent}
                className="w-full py-2.5 border-2 border-dashed border-slate-200 text-slate-500 rounded-xl hover:border-blue-300 hover:text-blue-500 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
              >
                <Plus size={16} /> 학생 추가
              </button>

              {error && <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setStep('done')}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors"
                >
                  나중에 입력
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '완료'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
