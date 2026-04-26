'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Search, X, Pencil, Trash2, Upload, CheckSquare, Square, ChevronRight,
  Users, KeyRound, CheckCircle2, XCircle, Loader2, RefreshCw, UserPlus,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatPhone } from '@/lib/auth'

type PageTab = 'list' | 'accounts'

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
  status: 'active' | 'inactive'
  withdrawn_at: string | null
  user_id: string | null
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

// ──────────────────────────────────────────────────────────
// 계정 상태 타입
// ──────────────────────────────────────────────────────────
type AccountStatus = {
  studentId: string
  studentHasAccount: boolean
  parentHasAccount: boolean
  creating: 'student' | 'parent' | null
}

export default function StudentsPage() {
  const router = useRouter()
  const [pageTab, setPageTab] = useState<PageTab>('list')

  // ── 공통 ──
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [academyId, setAcademyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // ── 학생 목록 탭 ──
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<StudentForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [classFilter, setClassFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive'>('active')
  const [importError, setImportError] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  type ParsedStudent = { academy_id: string; name: string; school_name: string | null; grade: string; phone: string; parent_phone: string | null }
  const [pendingImport, setPendingImport] = useState<ParsedStudent[]>([])
  const [conflicts, setConflicts] = useState<{ existing: Student; incoming: ParsedStudent }[]>([])
  const [showConflictModal, setShowConflictModal] = useState(false)

  // ── 계정 관리 탭 ──
  const [accountStatuses, setAccountStatuses] = useState<AccountStatus[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountSearch, setAccountSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState<'all' | 'missing'>('all')
  const [bulkCreating, setBulkCreating] = useState(false)
  const [bulkResult, setBulkResult] = useState<{
    studentCreated: number; studentSkipped: number
    parentCreated: number; parentSkipped: number; errors: string[]
  } | null>(null)

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

  // 계정 탭으로 전환할 때마다 최신 현황 로드
  useEffect(() => {
    if (pageTab === 'accounts') {
      loadAccountStatuses(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTab])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: membership } = await supabase
      .from('academy_teachers').select('academy_id').eq('teacher_id', user.id).single()
    if (!membership) return

    setAcademyId(membership.academy_id)

    const [{ data: studentData }, { data: classData }] = await Promise.all([
      supabase.from('students')
        .select('id, name, school_name, grade, phone, parent_phone, parent_relation, memo, enrolled_at, status, withdrawn_at, user_id, class_students(classes(id, name))')
        .eq('academy_id', membership.academy_id)
        .order('name'),
      supabase.from('classes').select('id, name').eq('academy_id', membership.academy_id).order('name'),
    ])

    setStudents((studentData as any) ?? [])
    setClasses(classData ?? [])
    setLoading(false)
  }

  // 계정 현황 로드 — 서비스 롤 API를 통해 RLS 우회, profiles 테이블 기준으로 정확하게 조회
  async function loadAccountStatuses(force = false) {
    if (accountsLoading && !force) return
    setAccountsLoading(true)
    setBulkResult(null)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setAccountsLoading(false); return }

    const res = await fetch('/api/account-status', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })

    if (!res.ok) {
      setAccountsLoading(false)
      return
    }

    const json = await res.json()
    const statusMap = new Map<string, { studentHasAccount: boolean; parentHasAccount: boolean }>(
      (json.data ?? []).map((item: any) => [
        item.studentId,
        { studentHasAccount: item.studentHasAccount, parentHasAccount: item.parentHasAccount },
      ])
    )

    setAccountStatuses(prev => {
      // 기존 creating 상태는 유지하면서 has/account 값만 갱신
      const next: AccountStatus[] = students
        .filter(s => (s.status ?? 'active') === 'active')
        .map(s => {
          const info = statusMap.get(s.id)
          const existing = prev.find(p => p.studentId === s.id)
          return {
            studentId: s.id,
            studentHasAccount: info?.studentHasAccount ?? false,
            parentHasAccount: info?.parentHasAccount ?? false,
            creating: existing?.creating ?? null,
          }
        })
      return next
    })

    setAccountsLoading(false)
  }

  // 개별 계정 생성
  async function createSingleAccount(studentId: string, target: 'student' | 'parent') {
    setAccountStatuses(prev => prev.map(s =>
      s.studentId === studentId ? { ...s, creating: target } : s
    ))

    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/create-single-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ student_id: studentId, target }),
    })
    const result = await res.json()

    if (!res.ok && res.status !== 409) {
      alert(result.error ?? '오류가 발생했어요.')
    }

    // 결과 반영
    setAccountStatuses(prev => prev.map(s => {
      if (s.studentId !== studentId) return s
      return {
        ...s,
        creating: null,
        studentHasAccount: target === 'student' ? true : s.studentHasAccount,
        parentHasAccount: target === 'parent' ? true : s.parentHasAccount,
      }
    }))
  }

  // 일괄 계정 생성
  async function createAllAccounts() {
    if (!confirm('재원 중인 모든 학생과 학부모 계정을 일괄 생성할까요?\n이미 계정이 있는 경우는 건너뜁니다.')) return
    setBulkCreating(true)
    setBulkResult(null)

    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/create-student-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    })
    const result = await res.json()
    setBulkCreating(false)

    if (!res.ok) { alert(result.error ?? '오류가 발생했어요.'); return }
    setBulkResult(result)
    // 계정 목록 새로고침
    await loadAccountStatuses(true)
  }

  // ────── 학생 목록 탭 함수들 ──────

  function openAdd() {
    setForm({ ...emptyForm, classIds: (classFilter && classFilter !== 'none') ? [classFilter] : [] })
    setEditingId(null)
    setError('')
    setShowForm(true)
  }

  function openEdit(s: Student) {
    setForm({
      name: s.name, school_name: s.school_name ?? '', grade: s.grade,
      phone: formatPhone(s.phone),
      parentPhone: s.parent_phone ? formatPhone(s.parent_phone) : '',
      parentRelation: s.parent_relation ?? '', memo: s.memo ?? '',
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

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(s => s.id)))
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    if (!confirm(`선택한 ${selectedIds.size}명의 학생을 삭제할까요?\n출결·성적 등 모든 데이터가 함께 삭제돼요.`)) return
    await supabase.from('students').delete().in('id', [...selectedIds])
    setSelectedIds(new Set())
    setSelectMode(false)
    await loadData()
  }

  function exitSelectMode() { setSelectMode(false); setSelectedIds(new Set()) }

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

    const foundConflicts: { existing: Student; incoming: ParsedStudent }[] = []
    const toInsert: ParsedStudent[] = []

    for (const incoming of parsed) {
      const existing = students.find(s => s.phone === incoming.phone)
      if (existing) foundConflicts.push({ existing, incoming })
      else toInsert.push(incoming)
    }

    if (foundConflicts.length === 0) {
      await doInsert(toInsert)
    } else {
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
      if (classFilter && classFilter !== 'none' && inserted && inserted.length > 0) {
        await supabase.from('class_students').insert(
          inserted.map((s: { id: string }) => ({ class_id: classFilter, student_id: s.id }))
        )
      }
    }
    await loadData()
    setImporting(false)
  }

  async function handleConflictSkip() {
    setShowConflictModal(false)
    setImporting(true)
    await doInsert(pendingImport)
    setConflicts([])
    setPendingImport([])
  }

  async function handleConflictOverwrite() {
    setShowConflictModal(false)
    setImporting(true)
    for (const { existing, incoming } of conflicts) {
      await supabase.from('students').update({
        name: incoming.name, school_name: incoming.school_name,
        grade: incoming.grade, parent_phone: incoming.parent_phone,
      }).eq('id', existing.id)
    }
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

  // ── 필터 ──
  const filtered = students.filter(s => {
    if ((s.status ?? 'active') !== statusFilter) return false
    if (classFilter === 'none') { if (s.class_students.length > 0) return false }
    else if (classFilter) { if (!s.class_students.some(cs => cs.classes.id === classFilter)) return false }
    return (
      s.name.includes(search) ||
      (s.school_name ?? '').includes(search) ||
      (s.grade + '학년').includes(search) ||
      s.phone.includes(search.replace(/-/g, ''))
    )
  })

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length

  // 계정 관리 탭 — 재원 학생만
  const activeStudents = students.filter(s => (s.status ?? 'active') === 'active')
  const filteredAccountStudents = activeStudents.filter(s => {
    const acSt = accountStatuses.find(a => a.studentId === s.id)
    if (accountFilter === 'missing') {
      if (!acSt) return true
      if (acSt.studentHasAccount && (acSt.parentHasAccount || !s.parent_phone)) return false
      return true
    }
    if (!accountSearch) return true
    return s.name.includes(accountSearch) || s.phone.includes(accountSearch.replace(/-/g, ''))
  }).filter(s => {
    if (!accountSearch) return true
    return s.name.includes(accountSearch) || s.phone.includes(accountSearch.replace(/-/g, ''))
  })

  // 계정이 아직 없는 학생/학부모 수
  const missingCount = accountStatuses.length > 0
    ? accountStatuses.filter(a =>
        !a.studentHasAccount || (!a.parentHasAccount && !!activeStudents.find(st => st.id === a.studentId)?.parent_phone)
      ).length
    : null  // 아직 로드 전

  // 전체 계정이 이미 모두 생성된 경우 일괄 생성 버튼 비활성화
  const allAccountsCreated = accountStatuses.length > 0 && missingCount === 0

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* 페이지 제목 */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">학생 관리</h1>
        <p className="text-sm text-slate-500 mt-0.5">재원 {activeStudents.length}명 / 전체 {students.length}명</p>
      </div>

      {/* 탭 */}
      <div className="flex bg-slate-100 rounded-xl p-1">
        <button
          onClick={() => setPageTab('list')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all ${
            pageTab === 'list' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users size={14} /> 학생 목록
        </button>
        <button
          onClick={() => setPageTab('accounts')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all ${
            pageTab === 'accounts' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <KeyRound size={14} /> 계정 관리
        </button>
      </div>

      {/* ══════════════════════════════════
          학생 목록 탭
      ══════════════════════════════════ */}
      {pageTab === 'list' && (
        <>
          {/* 액션 버튼 — 오른쪽 정렬 */}
          <div className="flex justify-end">
            {!selectMode ? (
              <div className="flex gap-2 flex-wrap justify-end">
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
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap justify-end">
                <button onClick={toggleSelectAll}
                  className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm"
                >
                  {allSelected ? <CheckSquare size={15} className="text-blue-600" /> : <Square size={15} />}
                  {allSelected ? '전체 해제' : '전체 선택'}
                </button>
                <button onClick={exitSelectMode}
                  className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors text-sm"
                >
                  취소
                </button>
                <button onClick={handleBulkDelete} disabled={selectedIds.size === 0}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-colors text-sm disabled:opacity-40"
                >
                  <Trash2 size={15} />
                  {selectedIds.size > 0 ? `${selectedIds.size}명 삭제` : '삭제'}
                </button>
              </div>
            )}
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

          {/* 재원/퇴원 필터 — 검색창 아래 */}
          <div className="flex gap-2">
            <button
              onClick={() => { setStatusFilter('active'); setClassFilter(null) }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                statusFilter === 'active' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
              }`}
            >재원</button>
            <button
              onClick={() => { setStatusFilter('inactive'); setClassFilter(null) }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                statusFilter === 'inactive' ? 'bg-slate-500 text-white border-slate-500' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
              }`}
            >퇴원</button>
          </div>

          {/* 반 필터 */}
          {classes.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setClassFilter(null)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                  classFilter === null ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                }`}
              >전체</button>
              {classes.map(c => (
                <button key={c.id} onClick={() => setClassFilter(classFilter === c.id ? null : c.id)}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                    classFilter === c.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                  }`}
                >{c.name}</button>
              ))}
              <button onClick={() => setClassFilter(classFilter === 'none' ? null : 'none')}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                  classFilter === 'none' ? 'bg-slate-500 text-white border-slate-500' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                }`}
              >미배정</button>
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
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${s.status === 'inactive' ? 'bg-slate-100' : 'bg-blue-100'}`}>
                          <span className={`font-bold text-sm ${s.status === 'inactive' ? 'text-slate-400' : 'text-blue-600'}`}>{s.name[0]}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`font-semibold ${s.status === 'inactive' ? 'text-slate-400' : 'text-slate-800'}`}>{s.name}</p>
                          {s.status === 'inactive' && <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-400 rounded-full">퇴원</span>}
                          {s.school_name && <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">{s.school_name}</span>}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'inactive' ? 'bg-slate-50 text-slate-400' : 'bg-blue-50 text-blue-600'}`}>{s.grade}학년</span>
                        </div>
                        <p className="text-sm text-slate-400">{formatPhone(s.phone)}{classList ? ` · ${classList}` : ''}</p>
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
        </>
      )}

      {/* ══════════════════════════════════
          계정 관리 탭
      ══════════════════════════════════ */}
      {pageTab === 'accounts' && (
        <>
          {/* 안내 + 일괄 생성 */}
          <div className={`border rounded-2xl p-5 space-y-3 ${allAccountsCreated ? 'bg-emerald-50 border-emerald-100' : 'bg-violet-50 border-violet-100'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <h2 className={`font-bold text-sm ${allAccountsCreated ? 'text-emerald-800' : 'text-violet-800'}`}>계정 일괄 생성</h2>
                {allAccountsCreated ? (
                  <p className="text-xs text-emerald-700 mt-1">
                    ✅ 재원생 전원의 계정이 이미 생성되어 있어요.
                  </p>
                ) : (
                  <p className="text-xs text-violet-600 mt-1 leading-relaxed">
                    전화번호 → 로그인 ID &nbsp;·&nbsp; 010 제외 뒤 8자리 → 초기 비밀번호<br />
                    예) 010-1234-5678 → 비밀번호: <span className="font-semibold">12345678</span><br />
                    이미 계정이 있는 경우는 자동으로 건너뜁니다.
                    {missingCount !== null && (
                      <span className="block mt-1 font-semibold text-violet-700">
                        현재 계정 미생성: {missingCount}명
                      </span>
                    )}
                  </p>
                )}
              </div>
              <button
                onClick={createAllAccounts}
                disabled={bulkCreating || allAccountsCreated}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              >
                {bulkCreating
                  ? <><Loader2 size={14} className="animate-spin" /> 생성 중...</>
                  : <><UserPlus size={14} /> 전체 일괄 생성</>
                }
              </button>
            </div>

            {/* 생성 중 안내 */}
            {bulkCreating && (
              <div className="bg-white rounded-xl px-4 py-3 border border-violet-100 flex items-center gap-3">
                <Loader2 size={16} className="animate-spin text-violet-500 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-slate-700">계정 생성 중이에요</p>
                  <p className="text-xs text-slate-400 mt-0.5">학생 수에 따라 1~2분 정도 걸릴 수 있어요. 페이지를 닫지 마세요.</p>
                </div>
              </div>
            )}

            {/* 일괄 생성 결과 */}
            {bulkResult && !bulkCreating && (
              <div className="bg-white rounded-xl p-4 space-y-2 border border-violet-100">
                <p className="text-xs font-bold text-slate-700">생성 완료!</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: '학생 계정 생성', value: bulkResult.studentCreated, color: 'text-violet-700' },
                    { label: '학생 건너뜀',    value: bulkResult.studentSkipped, color: 'text-slate-500' },
                    { label: '학부모 계정 생성', value: bulkResult.parentCreated, color: 'text-violet-700' },
                    { label: '학부모 건너뜀',   value: bulkResult.parentSkipped, color: 'text-slate-500' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-slate-50 rounded-lg px-3 py-2">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className={`text-lg font-black ${color}`}>{value}명</p>
                    </div>
                  ))}
                </div>
                {bulkResult.errors.length > 0 && (
                  <div className="bg-red-50 rounded-lg px-3 py-2">
                    <p className="text-xs font-medium text-red-700 mb-1">오류</p>
                    {bulkResult.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 필터 + 검색 + 새로고침 */}
          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex bg-slate-100 rounded-xl p-1 flex-shrink-0">
              <button
                onClick={() => setAccountFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  accountFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                }`}
              >전체</button>
              <button
                onClick={() => setAccountFilter('missing')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  accountFilter === 'missing' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                }`}
              >계정 없음</button>
            </div>
            <div className="relative flex-1 min-w-40">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text" value={accountSearch} onChange={e => setAccountSearch(e.target.value)}
                placeholder="이름 또는 전화번호 검색"
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <button
              onClick={() => loadAccountStatuses(true)}
              disabled={accountsLoading}
              className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40"
              title="새로고침"
            >
              <RefreshCw size={15} className={accountsLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* 계정 현황 목록 */}
          {accountsLoading ? (
            <div className="text-center py-16 text-slate-400 text-sm flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> 계정 현황 조회 중...
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-sm font-bold text-slate-800">학생/학부모 계정 현황</span>
                  <span className="text-xs text-slate-400 ml-2">재원 {activeStudents.length}명</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-500" /> 계정 있음</span>
                  <span className="flex items-center gap-1"><XCircle size={12} className="text-slate-300" /> 계정 없음</span>
                </div>
              </div>

              {filteredAccountStudents.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  {accountFilter === 'missing' ? '계정이 없는 학생이 없어요 🎉' : '학생이 없어요'}
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {filteredAccountStudents.map(s => {
                    const acSt = accountStatuses.find(a => a.studentId === s.id)
                    const studentHas = acSt?.studentHasAccount ?? false
                    const parentHas = acSt?.parentHasAccount ?? false
                    const hasParent = !!s.parent_phone

                    return (
                      <div key={s.id} className="px-5 py-4">
                        {/* 학생 이름 행 */}
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-blue-600 font-bold text-sm">{s.name[0]}</span>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-800">{s.name}</p>
                              <p className="text-xs text-slate-400">{s.school_name ? `${s.school_name} · ` : ''}{s.grade}학년</p>
                            </div>
                          </div>
                        </div>

                        {/* 학생 계정 */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {studentHas
                              ? <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                              : <XCircle size={15} className="text-slate-300 flex-shrink-0" />
                            }
                            <div>
                              <span className="text-xs font-medium text-slate-700">학생 계정</span>
                              <span className="text-xs text-slate-400 ml-1.5">{formatPhone(s.phone)}</span>
                            </div>
                          </div>
                          {!studentHas && (
                            <button
                              onClick={() => createSingleAccount(s.id, 'student')}
                              disabled={acSt?.creating === 'student'}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                              {acSt?.creating === 'student'
                                ? <Loader2 size={11} className="animate-spin" />
                                : <Plus size={11} />
                              }
                              계정 생성
                            </button>
                          )}
                        </div>

                        {/* 학부모 계정 */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {hasParent
                              ? parentHas
                                ? <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                                : <XCircle size={15} className="text-slate-300 flex-shrink-0" />
                              : <XCircle size={15} className="text-slate-200 flex-shrink-0" />
                            }
                            <div>
                              <span className="text-xs font-medium text-slate-700">학부모 계정</span>
                              {hasParent
                                ? <span className="text-xs text-slate-400 ml-1.5">{formatPhone(s.parent_phone!)}</span>
                                : <span className="text-xs text-slate-300 ml-1.5">연락처 없음</span>
                              }
                            </div>
                          </div>
                          {hasParent && !parentHas && (
                            <button
                              onClick={() => createSingleAccount(s.id, 'parent')}
                              disabled={acSt?.creating === 'parent'}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
                            >
                              {acSt?.creating === 'parent'
                                ? <Loader2 size={11} className="animate-spin" />
                                : <Plus size={11} />
                              }
                              계정 생성
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-slate-400 text-center pb-2">
            * 계정 생성 후 학생·학부모에게 <span className="font-medium">전화번호</span>와 <span className="font-medium">010 제외 뒤 8자리</span>를 초기 비밀번호로 알려주세요.
          </p>
        </>
      )}

      {/* ══ 추가/수정 모달 ══ */}
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
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">학교명</label>
                  <input type="text" value={form.school_name} onChange={e => setForm({ ...form, school_name: e.target.value })}
                    placeholder="일산동고"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">학부모 전화번호</label>
                  <input type="tel" value={form.parentPhone} onChange={e => setForm({ ...form, parentPhone: formatPhone(e.target.value) })}
                    placeholder="010-0000-0000"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">관계</label>
                  <input type="text" value={form.parentRelation} onChange={e => setForm({ ...form, parentRelation: e.target.value })}
                    placeholder="엄마, 아빠 등"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
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

      {/* ══ 중복 학생 처리 모달 ══ */}
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
              <button onClick={handleConflictOverwrite}
                className="w-full py-3 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors">
                덮어쓰기 (기존 정보를 CSV 내용으로 교체)
              </button>
              <button onClick={handleConflictSkip}
                className="w-full py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">
                건너뛰기 (중복 제외하고 나머지만 가져오기)
              </button>
              <button onClick={() => { setShowConflictModal(false); setConflicts([]); setPendingImport([]) }}
                className="w-full py-2 text-slate-400 text-sm hover:text-slate-600 transition-colors">
                전체 취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
