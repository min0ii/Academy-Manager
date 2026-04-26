'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Pencil, Trash2, ChevronRight, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

type Schedule = { day_of_week: number; start_time: string; end_time: string }
type Class = {
  id: string
  name: string
  student_count: number
  schedules: Schedule[]
}

export default function ClassesPage() {
  const router = useRouter()
  const [classes, setClasses] = useState<Class[]>([])
  const [academyId, setAcademyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return

    const { data: membership } = await supabase
      .from('academy_teachers').select('academy_id').eq('teacher_id', user.id).single()
    if (!membership) return
    setAcademyId(membership.academy_id)

    const { data } = await supabase
      .from('classes')
      .select('id, name, class_students(student_id), class_schedules(day_of_week, start_time, end_time)')
      .eq('academy_id', membership.academy_id)
      .order('name')

    const formatted: Class[] = (data ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      student_count: (c.class_students ?? []).length,
      schedules: (c.class_schedules ?? []).sort((a: Schedule, b: Schedule) => a.day_of_week - b.day_of_week),
    }))

    setClasses(formatted)
    setLoading(false)
  }

  function openAdd() {
    setName('')
    setEditingId(null)
    setError('')
    setShowForm(true)
  }

  function openEdit(c: Class, e: React.MouseEvent) {
    e.stopPropagation()
    setName(c.name)
    setEditingId(c.id)
    setError('')
    setShowForm(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')

    if (editingId) {
      const { error: err } = await supabase.from('classes').update({ name: name.trim() }).eq('id', editingId)
      if (err) { setError('저장 중 오류가 발생했어요.'); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('classes').insert({ academy_id: academyId, name: name.trim() })
      if (err) { setError('저장 중 오류가 발생했어요.'); setSaving(false); return }
    }

    await loadData()
    setSaving(false)
    setShowForm(false)
  }

  async function handleDelete(id: string, className: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`"${className}" 반을 삭제할까요?\n소속 학생의 반 배정 정보와 수업 세션이 모두 삭제돼요.`)) return
    await supabase.from('classes').delete().eq('id', id)
    await loadData()
  }

  function formatSchedule(schedules: Schedule[]) {
    if (schedules.length === 0) return '시간표 없음'
    return schedules
      .map(s => `${DAYS[s.day_of_week]}요일 ${s.start_time.slice(0, 5)}~${s.end_time.slice(0, 5)}`)
      .join(' · ')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">수업 관리</h1>
          <p className="text-sm text-slate-500 mt-0.5">전체 {classes.length}개 반</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors text-sm"
        >
          <Plus size={16} /> 반 추가
        </button>
      </div>

      {/* 반 목록 */}
      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
      ) : classes.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg mb-1">아직 반이 없어요</p>
          <p className="text-sm">반을 추가해서 학생들을 배정해보세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {classes.map(c => (
            <div
              key={c.id}
              onClick={() => router.push(`/dashboard/classes/${c.id}`)}
              className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                <span className="text-blue-600 font-bold text-lg">{c.name[0]}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800">{c.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Users size={12} /> {c.student_count}명
                  </span>
                  <span className="text-xs text-slate-400 truncate">{formatSchedule(c.schedules)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={e => openEdit(c, e)}
                  className="p-2 text-slate-400 hover:text-blue-500 transition-colors"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={e => handleDelete(c.id, c.name, e)}
                  className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
                <ChevronRight size={16} className="text-slate-300 ml-1" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 반 추가/수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">{editingId ? '반 이름 수정' : '반 추가'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">반 이름 *</label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="예: 중3 심화반" required autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              {error && <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">
                  취소
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
