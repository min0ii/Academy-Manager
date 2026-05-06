'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Folder, FolderOpen, FileText, Plus, ChevronRight, ChevronLeft,
  Pencil, Trash2, X, Check, BookOpen, ArrowLeft, Save,
  GraduationCap, ChevronDown,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────

type QBFolder = { id: string; name: string; parent_id: string | null; created_at: string }
type QBSet   = { id: string; title: string; folder_id: string | null; created_at: string; updated_at: string; questionCount: number }

type QBQuestion = {
  id?: string
  clientId: string
  order_num: number
  question_text: string
  question_type: 'multiple_choice' | 'short_answer'
  score: string
  choices: string[]
  correctChoiceIdx: number
  saAnswers: string[]
}

type ClassItem = { id: string; name: string }

function newQ(order: number): QBQuestion {
  return {
    clientId: Math.random().toString(36).slice(2),
    order_num: order,
    question_text: '',
    question_type: 'multiple_choice',
    score: '1',
    choices: ['', '', '', '', ''],
    correctChoiceIdx: 0,
    saAnswers: [''],
  }
}

// ── Breadcrumb path tracker ────────────────────────────────────────────────

type BreadcrumbItem = { id: string | null; name: string }

// ── QuestionCard ───────────────────────────────────────────────────────────

function QuestionCard({
  q, idx, total, onChange, onRemove,
}: {
  q: QBQuestion
  idx: number
  total: number
  onChange: (u: Partial<QBQuestion>) => void
  onRemove: () => void
}) {
  function updateChoice(ci: number, val: string) {
    const next = [...q.choices]; next[ci] = val; onChange({ choices: next })
  }
  function removeChoice(ci: number) {
    if (q.choices.length <= 2) return
    const next = q.choices.filter((_, i) => i !== ci)
    onChange({ choices: next, correctChoiceIdx: Math.min(q.correctChoiceIdx, next.length - 1) })
  }
  function updateSA(ai: number, val: string) {
    const next = [...q.saAnswers]; next[ai] = val; onChange({ saAnswers: next })
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center flex-shrink-0">
          {idx + 1}
        </span>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          {(['multiple_choice', 'short_answer'] as const).map((t, ti) => (
            <button key={t} onClick={() => onChange({ question_type: t })}
              className={`px-2.5 py-1.5 font-medium transition-colors ${ti > 0 ? 'border-l border-slate-200' : ''} ${q.question_type === t ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              {t === 'multiple_choice' ? '객관식' : '주관식'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <input type="number" value={q.score} onChange={e => onChange({ score: e.target.value })}
            min="0" step="0.5" placeholder="점"
            className="w-14 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          <span className="text-xs text-slate-400">점</span>
        </div>
        {total > 1 && (
          <button onClick={onRemove} className="text-slate-300 hover:text-red-400 transition-colors ml-1">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Question text */}
      <textarea
        value={q.question_text}
        onChange={e => onChange({ question_text: e.target.value })}
        placeholder={`${idx + 1}번 문제 내용`}
        rows={2}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-300"
      />

      {/* Choices (MC) */}
      {q.question_type === 'multiple_choice' && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">선택지 — 정답을 체크하세요</p>
          {q.choices.map((c, ci) => (
            <div key={ci} className="flex items-center gap-2">
              <button onClick={() => onChange({ correctChoiceIdx: ci })}
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${q.correctChoiceIdx === ci ? 'border-blue-500 bg-blue-500' : 'border-slate-300'}`}>
                {q.correctChoiceIdx === ci && <span className="w-2 h-2 rounded-full bg-white" />}
              </button>
              <span className="text-xs text-slate-400 w-4">①②③④⑤⑥⑦⑧⑨⑩'[ci]</span>
              <span className="text-xs font-medium text-slate-500 w-4 flex-shrink-0">{ci + 1}</span>
              <input value={c} onChange={e => updateChoice(ci, e.target.value)}
                placeholder={`선택지 ${ci + 1}`}
                className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              {q.choices.length > 2 && (
                <button onClick={() => removeChoice(ci)} className="text-slate-300 hover:text-red-400 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          {q.choices.length < 5 && (
            <button onClick={() => onChange({ choices: [...q.choices, ''] })}
              className="text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1 mt-1">
              <Plus size={12} /> 선택지 추가
            </button>
          )}
        </div>
      )}

      {/* Short answer */}
      {q.question_type === 'short_answer' && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">정답 (여러 개 가능)</p>
          {q.saAnswers.map((a, ai) => (
            <div key={ai} className="flex items-center gap-2">
              <input value={a} onChange={e => updateSA(ai, e.target.value)}
                placeholder={`정답 ${ai + 1}`}
                className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              {q.saAnswers.length > 1 && (
                <button onClick={() => onChange({ saAnswers: q.saAnswers.filter((_, i) => i !== ai) })}
                  className="text-slate-300 hover:text-red-400 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => onChange({ saAnswers: [...q.saAnswers, ''] })}
            className="text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1">
            <Plus size={12} /> 정답 추가
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main QuestionBank Component ─────────────────────────────────────────────

export default function QuestionBank({
  onCreateExamFromBank,
}: {
  onCreateExamFromBank?: (questions: QBQuestion[], setTitle: string) => void
}) {
  const [folderId, setFolderId] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ id: null, name: '문제은행' }])

  const [folders, setFolders] = useState<QBFolder[]>([])
  const [sets, setSets] = useState<QBSet[]>([])
  const [loading, setLoading] = useState(true)

  // 세트 편집 상태
  const [editingSetId, setEditingSetId] = useState<string | null>(null)
  const [editingSetTitle, setEditingSetTitle] = useState('')
  const [questions, setQuestions] = useState<QBQuestion[]>([newQ(1)])
  const [savingSet, setSavingSet] = useState(false)
  const [savedSet, setSavedSet] = useState(false)

  // 이름 변경 인라인
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingType, setRenamingType] = useState<'folder' | 'set' | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // 새 폴더/세트 생성 인라인
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingSet, setCreatingSet] = useState(false)
  const [newSetTitle, setNewSetTitle] = useState('')
  const [creating, setCreating] = useState(false)

  // 반에 시험 생성 모달
  const [showCreateExamModal, setShowCreateExamModal] = useState(false)
  const [classes, setClasses] = useState<ClassItem[]>([])
  const [loadingClasses, setLoadingClasses] = useState(false)
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  const [examTitle, setExamTitle] = useState('')
  const [examNoDeadline, setExamNoDeadline] = useState(true)
  const [creatingExam, setCreatingExam] = useState(false)

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  const loadFolder = useCallback(async (fId: string | null) => {
    setLoading(true)
    const token = await getToken()
    if (!token) { setLoading(false); return }
    const url = fId ? `/api/question-bank?folderId=${fId}` : `/api/question-bank`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { setLoading(false); return }
    const json = await res.json()
    setFolders(json.folders ?? [])
    setSets(json.sets ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadFolder(folderId) }, [folderId, loadFolder])

  function enterFolder(folder: QBFolder) {
    setFolderId(folder.id)
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }])
    setEditingSetId(null)
  }

  function navigateBreadcrumb(item: BreadcrumbItem) {
    const idx = breadcrumbs.findIndex(b => b.id === item.id)
    setBreadcrumbs(prev => prev.slice(0, idx + 1))
    setFolderId(item.id)
    setEditingSetId(null)
  }

  // ── 폴더 생성 ──────────────────────────────────────────────────────────

  async function createFolder() {
    if (!newFolderName.trim()) return
    setCreating(true)
    const token = await getToken()
    if (!token) { setCreating(false); return }
    const res = await fetch('/api/question-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'create_folder', name: newFolderName.trim(), parentId: folderId }),
    })
    if (res.ok) {
      const { folder } = await res.json()
      setFolders(prev => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)))
    }
    setCreatingFolder(false)
    setNewFolderName('')
    setCreating(false)
  }

  // ── 세트 생성 ──────────────────────────────────────────────────────────

  async function createSet() {
    if (!newSetTitle.trim()) return
    setCreating(true)
    const token = await getToken()
    if (!token) { setCreating(false); return }
    const res = await fetch('/api/question-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'create_set', title: newSetTitle.trim(), folderId }),
    })
    if (res.ok) {
      const { set } = await res.json()
      setSets(prev => [{ ...set, questionCount: 0 }, ...prev])
      // 생성 후 바로 세트 편집 열기
      openEditSet({ ...set, questionCount: 0 })
    }
    setCreatingSet(false)
    setNewSetTitle('')
    setCreating(false)
  }

  // ── 이름 변경 ──────────────────────────────────────────────────────────

  async function saveRename() {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return }
    const token = await getToken()
    if (!token) return
    if (renamingType === 'folder') {
      await fetch('/api/question-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'rename_folder', id: renamingId, name: renameValue.trim() }),
      })
      setFolders(prev => prev.map(f => f.id === renamingId ? { ...f, name: renameValue.trim() } : f))
    } else {
      await fetch('/api/question-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'rename_set', id: renamingId, title: renameValue.trim() }),
      })
      setSets(prev => prev.map(s => s.id === renamingId ? { ...s, title: renameValue.trim() } : s))
    }
    setRenamingId(null)
    setRenamingType(null)
    setRenameValue('')
  }

  // ── 삭제 ──────────────────────────────────────────────────────────────

  async function deleteItem(type: 'folder' | 'set', id: string, name: string) {
    const msg = type === 'folder'
      ? `"${name}" 폴더와 안에 있는 모든 세트·문제를 삭제할까요? 되돌릴 수 없어요.`
      : `"${name}" 세트와 안에 있는 모든 문제를 삭제할까요? 되돌릴 수 없어요.`
    if (!confirm(msg)) return
    const token = await getToken()
    if (!token) return
    await fetch(`/api/question-bank?type=${type}&id=${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (type === 'folder') setFolders(prev => prev.filter(f => f.id !== id))
    else setSets(prev => prev.filter(s => s.id !== id))
    if (editingSetId === id) setEditingSetId(null)
  }

  // ── 세트 편집 열기 ──────────────────────────────────────────────────────

  async function openEditSet(set: QBSet) {
    setEditingSetId(set.id)
    setEditingSetTitle(set.title)
    setSavedSet(false)
    const token = await getToken()
    if (!token) return
    const res = await fetch(`/api/question-bank/${set.id}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { setQuestions([newQ(1)]); return }
    const json = await res.json()
    const loaded: QBQuestion[] = (json.questions ?? []).map((q: any) => ({
      id: q.id,
      clientId: Math.random().toString(36).slice(2),
      order_num: q.order_num,
      question_text: q.question_text ?? '',
      question_type: q.question_type ?? 'multiple_choice',
      score: String(q.score ?? 1),
      choices: q.question_type === 'multiple_choice'
        ? (q.choices ?? []).map((c: any) => c.choice_text ?? '')
        : ['', '', '', '', ''],
      correctChoiceIdx: q.question_type === 'multiple_choice'
        ? Math.max(0, parseInt(q.answers?.[0]?.answer_text ?? '1') - 1)
        : 0,
      saAnswers: q.question_type === 'short_answer'
        ? (q.answers ?? []).map((a: any) => a.answer_text ?? '')
        : [''],
    }))
    setQuestions(loaded.length > 0 ? loaded : [newQ(1)])
  }

  // ── 세트 저장 ──────────────────────────────────────────────────────────

  async function saveSet() {
    if (!editingSetId) return
    setSavingSet(true)
    setSavedSet(false)
    const token = await getToken()
    if (!token) { setSavingSet(false); return }

    const payload = questions.map((q, i) => {
      if (q.question_type === 'multiple_choice') {
        return {
          order_num: i + 1,
          question_text: q.question_text,
          question_type: 'multiple_choice',
          score: parseFloat(q.score) || 1,
          choices: q.choices.map((c, ci) => ({ choice_num: ci + 1, choice_text: c })),
          answers: [{ answer_text: String(q.correctChoiceIdx + 1), order_num: 1 }],
        }
      }
      return {
        order_num: i + 1,
        question_text: q.question_text,
        question_type: 'short_answer',
        score: parseFloat(q.score) || 1,
        choices: [],
        answers: q.saAnswers.filter(a => a.trim()).map((a, ai) => ({ answer_text: a, order_num: ai + 1 })),
      }
    })

    const res = await fetch(`/api/question-bank/${editingSetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ questions: payload }),
    })
    setSavingSet(false)
    if (res.ok) {
      setSavedSet(true)
      setSets(prev => prev.map(s => s.id === editingSetId ? { ...s, questionCount: questions.length } : s))
    } else {
      alert('저장에 실패했어요.')
    }
  }

  function updateQ(idx: number, updates: Partial<QBQuestion>) {
    setSavedSet(false)
    setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...updates } : q))
  }

  // ── 반에 시험 생성 ──────────────────────────────────────────────────────

  async function openCreateExam() {
    if (!editingSetId) return
    // 먼저 저장
    if (!savedSet) {
      await saveSet()
    }
    setShowCreateExamModal(true)
    setExamTitle(editingSetTitle)
    setLoadingClasses(true)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setLoadingClasses(false); return }
    // academy_id 조회
    const { data: m } = await supabase.auth.getUser()
    const userId = m.user?.id
    if (!userId) { setLoadingClasses(false); return }
    const { data: teacherRow } = await supabase.from('academy_teachers').select('academy_id').eq('teacher_id', userId).single()
    const acadId = teacherRow?.academy_id
    if (!acadId) { setLoadingClasses(false); return }
    const { data: classData } = await supabase.from('classes').select('id, name').eq('academy_id', acadId).order('name')
    setClasses(classData ?? [])
    setLoadingClasses(false)
  }

  async function doCreateExam() {
    if (!editingSetId || !selectedClassId || !examTitle.trim()) {
      alert('반과 시험 이름을 입력해주세요.')
      return
    }
    setCreatingExam(true)
    const token = await getToken()
    if (!token) { setCreatingExam(false); return }

    // 문제은행 세트 문항 가져오기
    const res = await fetch(`/api/question-bank/${editingSetId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { alert('문제를 불러오지 못했어요.'); setCreatingExam(false); return }
    const { questions: dbQs } = await res.json()

    if (!dbQs?.length) { alert('세트에 문제가 없어요. 먼저 문제를 추가하고 저장해주세요.'); setCreatingExam(false); return }

    // exam 생성 API 호출
    const examPayload = {
      classId: selectedClassId,
      title: examTitle.trim(),
      examType: 'auto',
      noDeadline: examNoDeadline,
      answerReveal: 'after_close',
      questions: dbQs.map((q: any, i: number) => ({
        orderNum: i + 1,
        label: null,
        questionText: q.question_text ?? '',
        questionType: q.question_type,
        score: q.score ?? 1,
        choices: (q.choices ?? []).map((c: any) => ({ num: c.choice_num, text: c.choice_text ?? '' })),
        answers: (q.answers ?? []).map((a: any) => a.answer_text),
      })),
    }

    const createRes = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(examPayload),
    })

    setCreatingExam(false)
    if (createRes.ok) {
      setShowCreateExamModal(false)
      alert(`✅ "${examTitle.trim()}" 시험이 생성됐어요!\n시험 생성 탭에서 반을 선택해 확인해보세요.`)
    } else {
      const err = await createRes.json().catch(() => ({}))
      alert('시험 생성 실패: ' + (err.error ?? `HTTP ${createRes.status}`))
    }
  }

  // ── Render: Set Editor ─────────────────────────────────────────────────

  if (editingSetId) {
    const totalScore = questions.reduce((acc, q) => acc + (parseFloat(q.score) || 0), 0)
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => setEditingSetId(null)}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <input
              value={editingSetTitle}
              onChange={e => setEditingSetTitle(e.target.value)}
              className="text-xl font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none w-full transition-colors"
            />
            <p className="text-xs text-slate-400 mt-0.5">{questions.length}문제 · 총 {totalScore}점</p>
          </div>
          <button onClick={openCreateExam}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors flex-shrink-0">
            <GraduationCap size={15} /> 시험 생성
          </button>
          <button onClick={saveSet} disabled={savingSet}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-colors flex-shrink-0 ${savedSet ? 'bg-emerald-100 text-emerald-700 cursor-default' : savingSet ? 'bg-blue-600 text-white opacity-50' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            <Save size={15} />
            {savingSet ? '저장 중...' : savedSet ? '저장됨 ✓' : '저장'}
          </button>
        </div>

        {/* Question list */}
        <div className="space-y-3">
          {questions.map((q, i) => (
            <QuestionCard key={q.clientId} q={q} idx={i} total={questions.length}
              onChange={u => updateQ(i, u)}
              onRemove={() => {
                setSavedSet(false)
                setQuestions(prev => prev.filter((_, pi) => pi !== i))
              }}
            />
          ))}
        </div>

        {/* Add question */}
        <div className="flex gap-2">
          <button
            onClick={() => { setSavedSet(false); setQuestions(prev => [...prev, newQ(prev.length + 1)]) }}
            className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-500 rounded-2xl text-sm font-medium transition-colors">
            <Plus size={16} /> 문제 추가
          </button>
        </div>

        {/* Bottom save bar */}
        <div className="sticky bottom-0 bg-white border-t border-slate-100 pt-3 pb-1 flex gap-2">
          <button onClick={saveSet} disabled={savingSet}
            className={`flex-1 py-3 text-sm font-semibold rounded-xl transition-colors ${savedSet ? 'bg-emerald-100 text-emerald-700 cursor-default' : savingSet ? 'bg-blue-600 text-white opacity-50' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {savingSet ? '저장 중...' : savedSet ? '저장됨 ✓' : '저장하기'}
          </button>
          <button onClick={openCreateExam}
            className="px-5 py-3 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
            시험 생성
          </button>
        </div>

        {/* Create Exam Modal */}
        {showCreateExamModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800">반에 시험 생성</h2>
                <button onClick={() => setShowCreateExamModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">시험 이름</label>
                <input value={examTitle} onChange={e => setExamTitle(e.target.value)}
                  placeholder="시험 이름"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">반 선택</label>
                {loadingClasses ? (
                  <p className="text-sm text-slate-400 py-2">불러오는 중...</p>
                ) : classes.length === 0 ? (
                  <p className="text-sm text-slate-400 py-2">반이 없어요</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {classes.map(c => (
                      <button key={c.id} onClick={() => setSelectedClassId(c.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors text-left ${selectedClassId === c.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${selectedClassId === c.id ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          {c.name[0]}
                        </div>
                        {c.name}
                        {selectedClassId === c.id && <Check size={14} className="ml-auto text-blue-500" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">마감 방식</label>
                <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                  {[
                    { val: true, label: '마감 없음', desc: '제출 즉시 결과 확인' },
                    { val: false, label: '마감 있음', desc: '마감 후 결과 공개' },
                  ].map(({ val, label, desc }) => (
                    <button key={String(val)} onClick={() => setExamNoDeadline(val)}
                      className={`flex-1 py-2.5 px-3 text-left transition-colors ${examNoDeadline === val ? 'bg-blue-50 border-r border-blue-200 last:border-r-0' : 'hover:bg-slate-50 border-r border-slate-200 last:border-r-0'}`}>
                      <p className={`text-xs font-semibold ${examNoDeadline === val ? 'text-blue-700' : 'text-slate-700'}`}>{label}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={doCreateExam} disabled={creatingExam || !selectedClassId || !examTitle.trim()}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm">
                {creatingExam ? '생성 중...' : '시험 생성하기'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Render: Folder browser ─────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 flex-wrap">
        {breadcrumbs.map((b, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-slate-300" />}
            <button
              onClick={() => navigateBreadcrumb(b)}
              className={`text-sm font-medium transition-colors ${i === breadcrumbs.length - 1 ? 'text-slate-800 cursor-default' : 'text-blue-500 hover:text-blue-700'}`}
              disabled={i === breadcrumbs.length - 1}>
              {b.name}
            </button>
          </span>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={() => { setCreatingFolder(true); setCreatingSet(false) }}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-200 transition-colors">
          <Folder size={14} /> 폴더 추가
        </button>
        <button onClick={() => { setCreatingSet(true); setCreatingFolder(false) }}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors">
          <Plus size={14} /> 새 세트
        </button>
      </div>

      {/* New folder input */}
      {creatingFolder && (
        <div className="flex items-center gap-2 bg-white border border-blue-300 rounded-2xl px-4 py-3">
          <Folder size={16} className="text-slate-400 flex-shrink-0" />
          <input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') } }}
            placeholder="폴더 이름"
            className="flex-1 text-sm text-slate-800 focus:outline-none" />
          <button onClick={createFolder} disabled={creating || !newFolderName.trim()}
            className="text-blue-600 hover:text-blue-800 disabled:opacity-40 transition-colors">
            <Check size={16} />
          </button>
          <button onClick={() => { setCreatingFolder(false); setNewFolderName('') }}
            className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* New set input */}
      {creatingSet && (
        <div className="flex items-center gap-2 bg-white border border-blue-300 rounded-2xl px-4 py-3">
          <FileText size={16} className="text-blue-400 flex-shrink-0" />
          <input autoFocus value={newSetTitle} onChange={e => setNewSetTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createSet(); if (e.key === 'Escape') { setCreatingSet(false); setNewSetTitle('') } }}
            placeholder="세트 이름"
            className="flex-1 text-sm text-slate-800 focus:outline-none" />
          <button onClick={createSet} disabled={creating || !newSetTitle.trim()}
            className="text-blue-600 hover:text-blue-800 disabled:opacity-40 transition-colors">
            <Check size={16} />
          </button>
          <button onClick={() => { setCreatingSet(false); setNewSetTitle('') }}
            className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div>
      ) : folders.length === 0 && sets.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <BookOpen size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-base font-medium mb-1">아직 비어 있어요</p>
          <p className="text-sm">폴더나 문제 세트를 만들어보세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Folders */}
          {folders.map(folder => (
            <div key={folder.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {renamingId === folder.id ? (
                <div className="flex items-center gap-2 px-4 py-3">
                  <Folder size={18} className="text-amber-400 flex-shrink-0" />
                  <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenamingId(null) }}
                    className="flex-1 text-sm text-slate-800 focus:outline-none border-b border-blue-400" />
                  <button onClick={saveRename} className="text-blue-600 hover:text-blue-800 transition-colors"><Check size={16} /></button>
                  <button onClick={() => setRenamingId(null)} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={16} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => enterFolder(folder)} className="flex items-center gap-3 flex-1 text-left">
                    <Folder size={18} className="text-amber-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-slate-700">{folder.name}</span>
                  </button>
                  <button onClick={() => { setRenamingId(folder.id); setRenamingType('folder'); setRenameValue(folder.name) }}
                    className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg transition-colors">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => deleteItem('folder', folder.id, folder.name)}
                    className="p-1.5 text-slate-300 hover:text-red-400 rounded-lg transition-colors">
                    <Trash2 size={14} />
                  </button>
                  <button onClick={() => enterFolder(folder)} className="text-slate-300">
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Sets */}
          {sets.map(set => (
            <div key={set.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {renamingId === set.id ? (
                <div className="flex items-center gap-2 px-4 py-3">
                  <FileText size={18} className="text-blue-400 flex-shrink-0" />
                  <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenamingId(null) }}
                    className="flex-1 text-sm text-slate-800 focus:outline-none border-b border-blue-400" />
                  <button onClick={saveRename} className="text-blue-600 hover:text-blue-800 transition-colors"><Check size={16} /></button>
                  <button onClick={() => setRenamingId(null)} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={16} /></button>
                </div>
              ) : (
                <button onClick={() => openEditSet(set)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors group">
                  <FileText size={18} className="text-blue-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700">{set.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{set.questionCount}문제</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <button onClick={e => { e.stopPropagation(); setRenamingId(set.id); setRenamingType('set'); setRenameValue(set.title) }}
                      className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); deleteItem('set', set.id, set.title) }}
                      className="p-1.5 text-slate-300 hover:text-red-400 rounded-lg transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
