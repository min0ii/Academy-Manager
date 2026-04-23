'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, X, Pencil, Trash2, Upload, CheckSquare, Square, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatPhone } from '@/lib/auth'

type Student = {
  id: string
  name: string
  school_name: string | null
  grade: string
  phone: string
  parent_phone: string | null
  parent_relation: string | null
  memo: string | null
  enrolled_at: string
  class_students: { classes: { id: string; name: string } }[]
}

type Class = { id: string; name: string }

type StudentForm = {
  name: string
  school_name: string
  grade: string
  phone: string
  parentPhone: string
  parentRelation: string
  memo: string
  classIds: string[]
}

const emptyForm: StudentForm = {
  name: '', school_name: '', grade: '', phone: '',
  parentPhone: '', parentRelation: '', memo: '', classIds: []
}

export default function StudentsPage() {
  const router = useRouter()
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [academyId, setAcademyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<StudentForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [classFilter, setClassFilter] = useState<string | null>(null)
  const [importError, setImportError] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // CSV 중복 처리
  type ParsedStudent = { academy_id: string; name: string; school_name: string | null; grade: string; phone: string; parent_phone: string | null }
  const [pendingImport, setPendingImport] = useState<ParsedStudent[]>([])
  const [conflicts, setConflicts] = useState<{ existing: Student; incoming: ParsedStudent }[]>([])
  const [showConflictModal, setShowConflictModal] = useState(false)

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (showConflictModal) { setShowConflictModal(false); setConflicts([]); setPendingImport([]) }
      else if (showForm) setShowForm(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showForm, showConflictModal])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: academy } = await supabase
      .from('academies').select('id').eq('teacher_id', user.id).single()
    if (!academy) return

    setAcademyId(academy.id)

    const [{ data: studentData }, { data: classData }] = await Promise.all([
      supabase.from('students')
        .select('id, name, school_name, grade, phone, parent_phone, parent_relation, memo, enrolled_at, class_students(classes(id, name))')
        .eq('academy_id', academy.id)
        .order('name'),
      supabase.from('classes').select('id, name').eq('academy_id', academy.id).order('name'),
    ])

    setStudents((studentData as any) ?? [])
    setClasses(classData ?? [])
    setLoading(false)
  }

  function openAdd() {
    setForm({
      ...emptyForm,
      classIds: (classFilter && classFilter !== 'none') ? [classFilter] : [],
    })
    setEditingId(null)
    setError('')
    setShowForm(true)
  }

  function openEdit(s: Student) {
    setForm({
      name: s.name,
      school_name: s.school_name ?? '',
      grade: s.grade,
      phone: formatPhone(s.phone),
      parentPhone: s.parent_phone ? formatPhone(s.parent_phone) : '',
      parentRelation: s.parent_relation ?? '',
      memo: s.memo ?? '',
      classIds: s.class_students.map(cs => cs.classes.id),
    })
    setEditingId(s.id)
    setError('')
    setShowForm(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    const digits = form.phone.replace(/\D/g, '')

    if (editingId) {
      const { error: updateError } = await supabase.from('students').update({
        name: form.name, school_name: form.school_name || null,
        grade: form.grade, phone: digits,
        parent_phone: form.parentPhone.replace(/\D/g, '') || null,
        parent_relation: form.parentRelation || null,
        memo: form.memo || null,
      }).eq('id', editingId)
      if (updateError) { setError('저장 중 오류가 발생했어요.'); setSaving(false); return }
      await supabase.from('class_students').delete().eq('student_id', editingId)
      if (form.classIds.length > 0)
        await supabase.from('class_students').insert(form.classIds.map(cid => ({ class_id: cid, student_id: editingId })))
    } else {
      const { data: newStudent, error: insertError } = await supabase.from('students').insert({
        academy_id: academyId, name: form.name, school_name: form.school_name || null,
        grade: form.grade, phone: digits,
        parent_phone: form.parentPhone.replace(/\D/g, '') || null,
        parent_relation: form.parentRelation || null,
        memo: form.memo || null,
      }).select().single()
      if (insertError) { setError('저장 중 오류가 발생했어요.'); setSaving(false); return }
      if (form.classIds.length > 0)
        await supabase.from('class_students').insert(form.classIds.map(cid => ({ class_id: cid, student_id: newStudent.id })))
    }

    await loadData()
    setSaving(false)
    setShowForm(false)
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`${name} 학생을 삭제할까요?`)) return
    await supabase.from('students').delete().eq('id', id)
    await loadData()
  }

  // ── 선택 삭제 ──
  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(s => s.id)))
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    if (!confirm(`선택한 ${selectedIds.size}명의 학생을 삭제할까요?\n출결·성적 등 모든 데이터가 함께 삭제돼요.`)) return
    await supabase.from('students').delete().in('id', [...selectedIds])
    setSelectedIds(new Set())
    setSelectMode(false)
    await loadData()
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  // ── CSV 파싱 ──
  function parseCSV(text: string): ParsedStudent[] {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    let dataStart = 0
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      if (lines[i].includes('학생명') || lines[i].includes('이름')) { dataStart = i + 1; break }
    }
    const result: ParsedStudent[] = []
    for (const row of lines.slice(dataStart)) {
      const cols = row.split(',').map(c => c.replace(/^"|"$/g, '').trim())
      if (cols.length < 3) continue
      const hasNo = !isNaN(Number(cols[0]))
      const offset = hasNo ? 1 : 0
      const name = cols[offset]?.trim()
      const school_name = cols[offset + 1]?.trim() || null
      const grade = cols[offset + 2]?.trim() || ''
      const parentRaw = cols[offset + 3]?.trim() || ''
      const studentPhone = (cols[offset + 4] ?? cols[offset + 3])?.trim() || ''
      if (!name) continue
      const phone = studentPhone.replace(/\D/g, '')
      if (!phone) continue
      const parent_phone = parentRaw.replace(/\(.*?\)/g, '').replace(/\D/g, '') || null
      result.push({ academy_id: academyId!, name, school_name, grade, phone, parent_phone })
    }
    return result
  }

  // ── CSV 가져오기 ──
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !academyId) return
    setImporting(true)
    setImportError('')

    const text = await file.text()
    const parsed = parseCSV(text)

    if (parsed.length === 0) {
      setImportError('가져올 학생 데이터를 찾지 못했어요. 파일 형식을 확인해주세요.')
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    // 기존 학생과 전화번호 대조
    const foundConflicts: { existing: Student; incoming: ParsedStudent }[] = []
    const toInsert: ParsedStudent[] = []

    for (const incoming of parsed) {
      const existing = students.find(s => s.phone === incoming.phone)
      if (existing) {
        foundConflicts.push({ existing, incoming })
      } else {
        toInsert.push(incoming)
      }
    }

    // 중복 없으면 바로 저장
    if (foundConflicts.length === 0) {
      await doInsert(toInsert)
    } else {
      // 중복 있으면 모달 표시 (겹치지 않는 건 이미 toInsert에)
      setPendingImport(toInsert)
      setConflicts(foundConflicts)
      setShowConflictModal(true)
      setImporting(false)
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function doInsert(rows: ParsedStudent[]) {
    if (rows.length > 0) {
      const { data: inserted, error: dbError } = await supabase.from('students').insert(rows).select('id')
      if (dbError) { setImportError(`가져오기 오류: ${dbError.message}`); setImporting(false); return }
      // 반 필터가 활성화된 상태면 삽입된 학생 전원 해당 반에 자동 배정
      if (classFilter && classFilter !== 'none' && inserted && inserted.length > 0) {
        await supabase.from('class_students').insert(
          inserted.map((s: { id: string }) => ({ class_id: classFilter, student_id: s.id }))
        )
      }
    }
    await loadData()
    setImporting(false)
  }

  // 중복: 건너뛰고 나머지만 가져오기
  async function handleConflictSkip() {
    setShowConflictModal(false)
    setImporting(true)
    await doInsert(pendingImport)
    setConflicts([])
    setPendingImport([])
  }

  // 중복: 덮어쓰기 + 나머지 가져오기
  async function handleConflictOverwrite() {
    setShowConflictModal(false)
    setImporting(true)
    for (const { existing, incoming } of conflicts) {
      await supabase.from('students').update({
        name: incoming.name,
        school_name: incoming.school_name,
        grade: incoming.grade,
        parent_phone: incoming.parent_phone,
      }).eq('id', existing.id)
    }
    // 반 필터가 활성화된 상태면 덮어쓴 기존 학생도 해당 반에 배정 (이미 있으면 무시)
    if (classFilter && classFilter !== 'none' && conflicts.length > 0) {
      await supabase.from('class_students').upsert(
        conflicts.map(({ existing }) => ({ class_id: classFilter, student_id: existing.id })),
        { onConflict: 'class_id,student_id' }
      )
    }
    await doInsert(pendingImport)
    setConflicts([])
    setPendingImport([])
  }

  const filtered = students.filter(s => {
    if (classFilter === 'none') {
      if (s.class_students.length > 0) return false
    } else if (classFilter) {
      if (!s.class_students.some(cs => cs.classes.id === classFilter)) return false
    }
    return (
      s.name.includes(search) ||
      (s.school_name ?? '').includes(search) ||
      (s.grade + '학년').includes(search) ||
      s.phone.includes(search.replace(/-/g, ''))
    )
  })

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">학생 관리</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {classFilter ? `${filtered.length}명` : `전체 ${students.length}명`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!selectMode ? (
            <>
              <button
                onClick={() => setSelectMode(true)}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm"
              >
                <CheckSquare size={15} /> 선택 삭제
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm"
              >
                <Upload size={15} />
                {importing ? '가져오는 중...' : 'CSV 가져오기'}
              </button>
              <input ref={fileInputRef} type="file" accept=".csv" onChange={handleImport} className="hidden" />
              <button
                onClick={openAdd}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors text-sm"
              >
                <Plus size={16} /> 학생 추가
              </button>
            </>
          ) : (
            <>
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm"
              >
                {allSelected ? <CheckSquare size={15} className="text-blue-600" /> : <Square size={15} />}
                {allSelected ? '전체 해제' : '전체 선택'}
              </button>
              <button
                onClick={exitSelectMode}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm"
              >
                취소
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={15} />
                {selectedIds.size > 0 ? `${selectedIds.size}명 삭제` : '삭제'}
              </button>
            </>
          )}
        </div>
      </div>

      {importError && <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{importError}</p>}

      {/* 검색 */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="이름, 학교, 학년, 전화번호로 검색"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
        />
      </div>

      {/* 반 필터 */}
      {classes.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setClassFilter(null)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
              classFilter === null ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
            }`}
          >
            전체
          </button>
          {classes.map(c => (
            <button key={c.id}
              onClick={() => setClassFilter(classFilter === c.id ? null : c.id)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                classFilter === c.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
              }`}
            >
              {c.name}
            </button>
          ))}
          <button
            onClick={() => setClassFilter(classFilter === 'none' ? null : 'none')}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
              classFilter === 'none' ? 'bg-slate-500 text-white border-slate-500' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
            }`}
          >
            미배정
          </button>
        </div>
      )}

      {/* 학생 목록 */}
      {loading ? (
        <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg mb-1">학생이 없어요</p>
          <p className="text-sm">학생을 추가하거나 CSV 파일로 가져오세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => {
            const isSelected = selectedIds.has(s.id)
            const classList = s.class_students.map(cs => cs.classes.name).join(', ')
            return (
              <div key={s.id}
                className={`bg-white rounded-2xl border transition-colors ${isSelected ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-50 transition-colors rounded-2xl"
                  onClick={() => selectMode ? toggleSelect(s.id) : router.push(`/dashboard/students/${s.id}`)}
                >
                  {selectMode ? (
                    <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'bg-red-500 border-red-500' : 'border-slate-300'}`}>
                      {isSelected && <X size={14} className="text-white" />}
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 font-bold text-sm">{s.name[0]}</span>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-800">{s.name}</p>
                      {s.school_name && <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">{s.school_name}</span>}
                      <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">{s.grade}학년</span>
                    </div>
                    <p className="text-sm text-slate-500">{formatPhone(s.phone)}{classList ? ` · ${classList}` : ''}</p>
                  </div>

                  {!selectMode && (
                    <div className="flex items-center gap-1">
                      <button onClick={e => { e.stopPropagation(); openEdit(s) }} className="p-2 text-slate-400 hover:text-blue-500 transition-colors">
                        <Pencil size={15} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(s.id, s.name) }} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                        <Trash2 size={15} />
                      </button>
                      <ChevronRight size={16} className="text-slate-300" />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 추가/수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">{editingId ? '학생 정보 수정' : '학생 추가'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">이름 *</label>
                  <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="홍길동" required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">학교명</label>
                  <input type="text" value={form.school_name} onChange={e => setForm({ ...form, school_name: e.target.value })}
                    placeholder="일산동고"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">학년 *</label>
                <div className="flex gap-2">
                  {['1', '2', '3'].map(g => (
                    <button key={g} type="button" onClick={() => setForm({ ...form, grade: g })}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors ${form.grade === g ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-300'}`}>
                      {g}학년
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">학생 전화번호 *</label>
                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: formatPhone(e.target.value) })}
                  placeholder="010-0000-0000" required
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">학부모 전화번호</label>
                  <input type="tel" value={form.parentPhone} onChange={e => setForm({ ...form, parentPhone: formatPhone(e.target.value) })}
                    placeholder="010-0000-0000"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">관계</label>
                  <input type="text" value={form.parentRelation} onChange={e => setForm({ ...form, parentRelation: e.target.value })}
                    placeholder="엄마, 아빠 등"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
              </div>

              {classes.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">소속 반</label>
                  <div className="flex flex-wrap gap-2">
                    {classes.map(c => {
                      const selected = form.classIds.includes(c.id)
                      return (
                        <button key={c.id} type="button"
                          onClick={() => setForm({ ...form, classIds: selected ? form.classIds.filter(id => id !== c.id) : [...form.classIds, c.id] })}
                          className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'}`}>
                          {c.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">메모 (선생님만 보임)</label>
                <textarea value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })}
                  placeholder="특이사항 등" rows={2}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none" />
              </div>

              {error && <p className="text-red-500 text-sm bg-red-50 px-4 py-3 rounded-xl">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">취소</button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 중복 학생 처리 모달 */}
      {showConflictModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">이미 등록된 학생이 있어요</h2>
              <p className="text-sm text-slate-500 mt-1">
                전화번호가 일치하는 학생 <span className="font-semibold text-amber-600">{conflicts.length}명</span>이 이미 있어요.
                {pendingImport.length > 0 && ` 나머지 ${pendingImport.length}명은 정상 등록돼요.`}
              </p>
            </div>

            <div className="p-5 space-y-2 max-h-60 overflow-y-auto">
              {conflicts.map(({ existing, incoming }) => (
                <div key={existing.id} className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-amber-600 font-bold text-xs">{existing.name[0]}</span>
                  </div>
                  <div className="text-sm">
                    <p className="font-semibold text-slate-800">{existing.name}</p>
                    <p className="text-slate-500">{formatPhone(existing.phone)}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-5 border-t border-slate-100 space-y-2">
              <button
                onClick={handleConflictOverwrite}
                className="w-full py-3 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors"
              >
                덮어쓰기 (기존 정보를 CSV 내용으로 교체)
              </button>
              <button
                onClick={handleConflictSkip}
                className="w-full py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors"
              >
                건너뛰기 (중복 제외하고 나머지만 가져오기)
              </button>
              <button
                onClick={() => { setShowConflictModal(false); setConflicts([]); setPendingImport([]) }}
                className="w-full py-2 text-slate-400 text-sm hover:text-slate-600 transition-colors"
              >
                전체 취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
