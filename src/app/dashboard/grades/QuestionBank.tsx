'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import {
  Folder, FileText, Plus, ChevronRight, ChevronLeft, ChevronUp, ChevronDown,
  Pencil, Trash2, X, Check, BookOpen, ArrowLeft, Save,
  GraduationCap, GripVertical,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useDialog } from '@/components/AppDialog'
import { useDragSort } from '@/lib/useDragSort'

// ── Types ──────────────────────────────────────────────────────────────────

type QBFolder = { id: string; name: string; parent_id: string | null; created_at: string }
type QBSet   = { id: string; title: string; folder_id: string | null; created_at: string; updated_at: string; questionCount: number }

type QBSubQuestion = {
  id?: string
  clientId: string
  question_text: string
  question_type: 'multiple_choice' | 'short_answer'
  score: string
  choices: string[]
  correctChoiceIdxs: number[]
  saAnswers: string[]
}

type QBQuestion = {
  id?: string
  clientId: string
  order_num: number
  customLabel: string        // 사용자 지정 번호 (빈 문자열 = 순서 번호)
  question_text: string
  question_type: 'multiple_choice' | 'short_answer' | 'group'
  score: string
  choices: string[]
  correctChoiceIdxs: number[]
  saAnswers: string[]
  groupContext?: string
  children?: QBSubQuestion[]
}

type ClassItem = { id: string; name: string }
type BreadcrumbItem = { id: string | null; name: string }

function newQ(order: number): QBQuestion {
  return {
    clientId: Math.random().toString(36).slice(2),
    order_num: order,
    customLabel: '',
    question_text: '',
    question_type: 'multiple_choice',
    score: '1',
    choices: ['', '', '', '', ''],
    correctChoiceIdxs: [0],
    saAnswers: [''],
  }
}

function newQBSubQ(): QBSubQuestion {
  return {
    clientId: Math.random().toString(36).slice(2),
    question_text: '',
    question_type: 'multiple_choice',
    score: '1',
    choices: ['', '', '', '', ''],
    correctChoiceIdxs: [0],
    saAnswers: [''],
  }
}

// 문제의 표시 번호: customLabel이 있으면 그것, 없으면 순서 번호
function displayLabel(q: QBQuestion, idx: number): string {
  return q.customLabel.trim() || String(idx + 1)
}

// ── QBSubQCard (소문제 카드) ──────────────────────────────────────────────

function QBSubQCard({
  child, label, onChange, onRemove, canRemove,
}: {
  child: QBSubQuestion
  label: string
  onChange: (u: Partial<QBSubQuestion>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  function updateChoice(ci: number, val: string) {
    const next = [...child.choices]; next[ci] = val; onChange({ choices: next })
  }
  function removeChoice(ci: number) {
    if (child.choices.length <= 2) return
    const next = child.choices.filter((_, i) => i !== ci)
    onChange({ choices: next, correctChoiceIdxs: child.correctChoiceIdxs.filter(i => i < next.length) })
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md flex-shrink-0">{label}</span>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs bg-white">
          {(['multiple_choice', 'short_answer'] as const).map((t, ti) => (
            <button key={t} onClick={() => onChange({ question_type: t })}
              className={`px-2.5 py-1 font-medium transition-colors ${ti > 0 ? 'border-l border-slate-200' : ''} ${child.question_type === t ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              {t === 'multiple_choice' ? '객관식' : '주관식'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <input type="number" value={child.score} onChange={e => onChange({ score: e.target.value })}
            min="0" step="0.5" placeholder="점"
            className="w-12 px-1.5 py-1 rounded-lg border border-slate-200 text-xs text-slate-800 text-center bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          <span className="text-xs text-slate-400">점</span>
        </div>
        {canRemove && (
          <button onClick={onRemove} className="text-slate-300 hover:text-red-400 flex-shrink-0"><X size={14} /></button>
        )}
      </div>
      <textarea value={child.question_text} onChange={e => onChange({ question_text: e.target.value })}
        placeholder="소문제 내용 (선택사항)" rows={2}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 resize-none bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-300" />
      {child.question_type === 'multiple_choice' && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-500">선택지 — 정답을 체크하세요</p>
          {child.choices.map((c, ci) => (
            <div key={ci} className="flex items-center gap-2">
              <button onClick={() => {
                const idxs = child.correctChoiceIdxs.includes(ci)
                  ? child.correctChoiceIdxs.filter(i => i !== ci)
                  : [...child.correctChoiceIdxs, ci].sort((a, b) => a - b)
                onChange({ correctChoiceIdxs: idxs })
              }}
                className={`w-4 h-4 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${child.correctChoiceIdxs.includes(ci) ? 'border-blue-500 bg-blue-500' : 'border-slate-300'}`}>
                {child.correctChoiceIdxs.includes(ci) && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </button>
              <span className="text-xs text-slate-400 w-4 flex-shrink-0">{ci + 1}.</span>
              <input value={c} onChange={e => updateChoice(ci, e.target.value)} placeholder={`선택지 ${ci + 1}`}
                className="flex-1 px-2 py-1 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              {child.choices.length > 2 && (
                <button onClick={() => removeChoice(ci)} className="text-slate-300 hover:text-red-400 flex-shrink-0"><X size={12} /></button>
              )}
            </div>
          ))}
          {child.choices.length < 5 && (
            <button onClick={() => onChange({ choices: [...child.choices, ''] })}
              className="text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1">
              <Plus size={11} /> 선택지 추가
            </button>
          )}
        </div>
      )}
      {child.question_type === 'short_answer' && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-500">정답 (대소문자 무시)</p>
          {child.saAnswers.map((a, ai) => (
            <div key={ai} className="flex items-center gap-2">
              <input value={a}
                onChange={e => { const next = [...child.saAnswers]; next[ai] = e.target.value; onChange({ saAnswers: next }) }}
                placeholder={ai === 0 ? '정답 입력' : '추가 인정 답안'}
                className="flex-1 px-2 py-1 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              {child.saAnswers.length > 1 && (
                <button onClick={() => onChange({ saAnswers: child.saAnswers.filter((_, i) => i !== ai) })}
                  className="text-slate-300 hover:text-red-400 flex-shrink-0"><X size={12} /></button>
              )}
            </div>
          ))}
          <button onClick={() => onChange({ saAnswers: [...child.saAnswers, ''] })}
            className="text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1">
            <Plus size={11} /> 인정 답안 추가
          </button>
        </div>
      )}
    </div>
  )
}

// ── QuestionCard ──────────────────────────────────────────────────────────

function QuestionCard({
  q, idx, total, onChange, onRemove, onDragStart, isDragging, isDragOver,
}: {
  q: QBQuestion
  idx: number
  total: number
  onChange: (u: Partial<QBQuestion>) => void
  onRemove: () => void
  onDragStart?: (e: React.PointerEvent) => void
  isDragging?: boolean
  isDragOver?: boolean
}) {
  const parentLabel = q.customLabel.trim() || String(idx + 1)

  function updateChoice(ci: number, val: string) {
    const next = [...q.choices]; next[ci] = val; onChange({ choices: next })
  }
  function removeChoice(ci: number) {
    if (q.choices.length <= 2) return
    const next = q.choices.filter((_, i) => i !== ci)
    onChange({ choices: next, correctChoiceIdxs: q.correctChoiceIdxs.filter(i => i < next.length) })
  }
  function updateSA(ai: number, val: string) {
    const next = [...q.saAnswers]; next[ai] = val; onChange({ saAnswers: next })
  }

  // ── 그룹(소문제) 카드 ─────────────────────────────────────────────────
  if (q.question_type === 'group') {
    const children = q.children ?? []
    return (
      <div data-didx={idx}
        className={`bg-white border-2 rounded-2xl p-4 space-y-3 transition-all ${isDragOver ? 'border-purple-500 ring-2 ring-purple-200' : 'border-purple-200'} ${isDragging ? 'opacity-40' : ''}`}>
        <div className="flex items-center gap-2">
          <div onPointerDown={onDragStart} className="cursor-grab touch-none text-slate-300 hover:text-slate-500 flex-shrink-0 select-none">
            <GripVertical size={16} />
          </div>
          <input type="text" value={q.customLabel} onChange={e => onChange({ customLabel: e.target.value })}
            placeholder={String(idx + 1)} title="문제 번호"
            className="w-10 h-7 rounded-lg bg-purple-50 text-purple-600 text-xs font-bold text-center border border-purple-200 hover:border-purple-300 focus:border-purple-400 focus:bg-white focus:outline-none placeholder:text-purple-300 transition-colors" />
          <span className="text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md">소문제 그룹</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => onChange({
                question_type: 'short_answer',
                question_text: q.groupContext || '',
                groupContext: '',
                score: '1',
                saAnswers: [''],
                children: [],
              })}
              className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors">
              그룹 해제
            </button>
            {total > 1 && (
              <button onClick={onRemove} className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0">
                <X size={16} />
              </button>
            )}
          </div>
        </div>
        <textarea value={q.groupContext ?? ''} onChange={e => onChange({ groupContext: e.target.value })}
          placeholder="공통 지문 (선택사항)" rows={2}
          className="w-full px-3 py-2 rounded-xl border border-purple-100 bg-purple-50/30 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent placeholder:text-slate-300" />
        <div className="space-y-2.5">
          {children.map((child, ci) => (
            <QBSubQCard
              key={child.clientId}
              child={child}
              label={`${parentLabel}-${ci + 1}`}
              onChange={updates => {
                const next = [...children]; next[ci] = { ...child, ...updates }; onChange({ children: next })
              }}
              onRemove={() => onChange({ children: children.filter((_, i) => i !== ci) })}
              canRemove={children.length > 1}
            />
          ))}
        </div>
        <button onClick={() => onChange({ children: [...children, newQBSubQ()] })}
          className="w-full py-2 rounded-xl border border-dashed border-purple-300 text-xs text-purple-500 hover:bg-purple-50 hover:border-purple-400 transition-colors font-medium flex items-center justify-center gap-1">
          <Plus size={13} /> 소문제 추가
        </button>
      </div>
    )
  }

  // ── 일반 문제 카드 ─────────────────────────────────────────────────────
  return (
    <div data-didx={idx}
      className={`bg-white border rounded-2xl p-4 space-y-3 transition-all ${isDragOver ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'} ${isDragging ? 'opacity-40' : ''}`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <div onPointerDown={onDragStart} className="cursor-grab touch-none text-slate-300 hover:text-slate-500 flex-shrink-0 select-none">
          <GripVertical size={16} />
        </div>
        <input
          type="text"
          value={q.customLabel}
          onChange={e => onChange({ customLabel: e.target.value })}
          placeholder={String(idx + 1)}
          title="문제 번호 (클릭해서 수정)"
          className="w-10 h-7 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold text-center border border-transparent hover:border-slate-300 focus:border-blue-400 focus:bg-white focus:outline-none placeholder:text-slate-400 transition-colors"
        />
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

      <textarea
        value={q.question_text}
        onChange={e => onChange({ question_text: e.target.value })}
        placeholder={`${displayLabel(q, idx)}번 문제 내용`}
        rows={2}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-300"
      />

      {q.question_type === 'multiple_choice' && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">선택지 — 정답 선택 (복수 가능)</p>
          {q.choices.map((c, ci) => (
            <div key={ci} className="flex items-center gap-2">
              <button onClick={() => {
                const idxs = q.correctChoiceIdxs.includes(ci)
                  ? q.correctChoiceIdxs.filter(i => i !== ci)
                  : [...q.correctChoiceIdxs, ci].sort((a, b) => a - b)
                onChange({ correctChoiceIdxs: idxs })
              }}
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${q.correctChoiceIdxs.includes(ci) ? 'border-blue-500 bg-blue-500' : 'border-slate-300'}`}>
                {q.correctChoiceIdxs.includes(ci) && <span className="w-2 h-2 rounded-full bg-white" />}
              </button>
              <span className="text-xs font-semibold text-slate-500 w-4 flex-shrink-0 text-center">{ci + 1}</span>
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

      {/* 소문제로 전환 버튼 */}
      <div className="pt-1 flex justify-end">
        <button
          onClick={() => onChange({
            question_type: 'group',
            groupContext: q.question_text || '',
            question_text: '',
            score: '0',
            choices: [],
            saAnswers: [''],
            children: [newQBSubQ()],
          })}
          className="text-xs text-purple-500 hover:text-purple-700 font-medium flex items-center gap-1 transition-colors">
          소문제로 전환
        </button>
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function QuestionBank() {
  const { showAlert, showConfirm, dialog } = useDialog()
  // 폴더 탐색
  const [folderId, setFolderId] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ id: null, name: '문제은행' }])
  const [folders, setFolders] = useState<QBFolder[]>([])
  const [sets, setSets] = useState<QBSet[]>([])
  const [loading, setLoading] = useState(true)

  // 세트 편집
  const [editingSetId, setEditingSetId] = useState<string | null>(null)
  const [editingSetTitle, setEditingSetTitle] = useState('')
  const [questions, setQuestions] = useState<QBQuestion[]>([newQ(1)])
  const [loadingSet, setLoadingSet] = useState(false)
  const [savingSet, setSavingSet] = useState(false)
  const [savedSet, setSavedSet] = useState(false)
  const [openingExam, setOpeningExam] = useState(false)

  const { dragIdx: dragQIdx, dragOverIdx: dragQOverIdx, startDrag: startDragQ } =
    useDragSort(setQuestions, () => setSavedSet(false))

  // 폴더 드래그 순서 변경
  const [dragFolderIdx, setDragFolderIdx] = useState<number | null>(null)
  const [dragOverFolderIdx, setDragOverFolderIdx] = useState<number | null>(null)

  // 세트 드래그 순서 변경
  const [dragSetIdx, setDragSetIdx] = useState<number | null>(null)
  const [dragOverSetIdx, setDragOverSetIdx] = useState<number | null>(null)
  const [dragOverFolderIdForSet, setDragOverFolderIdForSet] = useState<string | null>(null)
  const [dragOverParentZone, setDragOverParentZone] = useState(false)

  // 모바일 이동 모달
  const [movingSetId, setMovingSetId] = useState<string | null>(null)
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null)
  const [allFolders, setAllFolders] = useState<QBFolder[]>([])
  const [loadingAllFolders, setLoadingAllFolders] = useState(false)

  // 인라인 이름변경
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingType, setRenamingType] = useState<'folder' | 'set' | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // 새 폴더/세트 생성
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingSet, setCreatingSet] = useState(false)
  const [newSetTitle, setNewSetTitle] = useState('')
  const [creating, setCreating] = useState(false)

  // 시험 생성 모달 (2단계)
  const [showCreateExamModal, setShowCreateExamModal] = useState(false)
  const [examModalStep, setExamModalStep] = useState<1 | 2>(1)
  const [selectedQClientIds, setSelectedQClientIds] = useState<Set<string>>(new Set())
  const [examNumbering, setExamNumbering] = useState<'original' | 'sequential'>('original')
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

  async function saveFolderOrder(ordered: QBFolder[]) {
    const token = await getToken()
    if (!token) return
    await fetch('/api/question-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'reorder_folders',
        orders: ordered.map((f, i) => ({ id: f.id, order_num: i + 1 })),
      }),
    })
  }

  function handleFolderReorder(toIdx: number) {
    if (dragFolderIdx === null || dragFolderIdx === toIdx) return
    const next = [...folders]
    const [dragged] = next.splice(dragFolderIdx, 1)
    next.splice(toIdx, 0, dragged)
    setFolders(next)
    setDragFolderIdx(null)
    setDragOverFolderIdx(null)
    void saveFolderOrder(next)
  }

  async function saveSetOrder(ordered: QBSet[]) {
    const token = await getToken()
    if (!token) return
    await fetch('/api/question-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'reorder_sets',
        orders: ordered.map((s, i) => ({ id: s.id, order_num: i + 1 })),
      }),
    })
  }

  function handleSetReorder(toIdx: number) {
    if (dragSetIdx === null || dragSetIdx === toIdx) return
    const next = [...sets]
    const [dragged] = next.splice(dragSetIdx, 1)
    next.splice(toIdx, 0, dragged)
    setSets(next)
    setDragSetIdx(null)
    setDragOverSetIdx(null)
    void saveSetOrder(next)
  }

  async function handleMoveSetIntoFolder(targetFolderId: string) {
    if (dragSetIdx === null) return
    const set = sets[dragSetIdx]
    setSets(prev => prev.filter((_, i) => i !== dragSetIdx))
    setDragSetIdx(null)
    setDragOverFolderIdForSet(null)
    const token = await getToken()
    if (!token) return
    await fetch('/api/question-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'move_set', id: set.id, folderId: targetFolderId }),
    })
  }

  async function handleMoveSetToParent() {
    if (dragSetIdx === null) return
    const set = sets[dragSetIdx]
    const parentId = breadcrumbs[breadcrumbs.length - 2]?.id ?? null  // 상위 폴더 id
    setSets(prev => prev.filter((_, i) => i !== dragSetIdx))
    setDragSetIdx(null)
    setDragOverParentZone(false)
    const token = await getToken()
    if (!token) return
    await fetch('/api/question-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'move_set', id: set.id, folderId: parentId }),
    })
  }

  // 모바일 ▲▼ 순서 변경
  function moveFolderUp(idx: number) {
    if (idx === 0) return
    const next = [...folders]; [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setFolders(next); void saveFolderOrder(next)
  }
  function moveFolderDown(idx: number) {
    if (idx === folders.length - 1) return
    const next = [...folders]; [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setFolders(next); void saveFolderOrder(next)
  }
  function moveSetUp(idx: number) {
    if (idx === 0) return
    const next = [...sets]; [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setSets(next); void saveSetOrder(next)
  }
  function moveSetDown(idx: number) {
    if (idx === sets.length - 1) return
    const next = [...sets]; [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setSets(next); void saveSetOrder(next)
  }

  // 모바일 이동 모달
  async function openMoveModal(setId: string) {
    setMovingSetId(setId)
    setLoadingAllFolders(true)
    const token = await getToken()
    if (!token) { setLoadingAllFolders(false); return }
    const res = await fetch('/api/question-bank?all=true', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setAllFolders((await res.json()).folders ?? [])
    setLoadingAllFolders(false)
  }
  async function doMoveSet(targetFolderId: string | null) {
    if (!movingSetId) return
    const token = await getToken()
    if (!token) return
    await fetch('/api/question-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'move_set', id: movingSetId, folderId: targetFolderId }),
    })
    setSets(prev => prev.filter(s => s.id !== movingSetId))
    setMovingSetId(null)
  }

  async function openFolderMoveModal(id: string) {
    setMovingFolderId(id)
    setLoadingAllFolders(true)
    const token = await getToken()
    if (!token) { setLoadingAllFolders(false); return }
    const res = await fetch('/api/question-bank?all=true', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setAllFolders((await res.json()).folders ?? [])
    setLoadingAllFolders(false)
  }

  async function doMoveFolder(targetParentId: string | null) {
    if (!movingFolderId) return
    const token = await getToken()
    if (!token) return
    await fetch('/api/question-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'move_folder', id: movingFolderId, parentId: targetParentId }),
    })
    setFolders(prev => prev.filter(f => f.id !== movingFolderId))
    setMovingFolderId(null)
  }

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
    setCreatingFolder(false); setNewFolderName(''); setCreating(false)
  }

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
      openEditSet({ ...set, questionCount: 0 })
    }
    setCreatingSet(false); setNewSetTitle(''); setCreating(false)
  }

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
    setRenamingId(null); setRenamingType(null); setRenameValue('')
  }

  async function deleteItem(type: 'folder' | 'set', id: string, name: string) {
    const msg = type === 'folder'
      ? `"${name}" 폴더와 안에 있는 모든 세트·문제를 삭제할까요? 되돌릴 수 없어요.`
      : `"${name}" 세트와 안에 있는 모든 문제를 삭제할까요? 되돌릴 수 없어요.`
    if (!await showConfirm(msg, { destructive: true })) return
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

  async function openEditSet(set: QBSet) {
    setEditingSetId(set.id)
    setEditingSetTitle(set.title)
    setSavedSet(false)
    setLoadingSet(true)
    const token = await getToken()
    if (!token) { setLoadingSet(false); return }
    const res = await fetch(`/api/question-bank/${set.id}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { setQuestions([newQ(1)]); return }
    const json = await res.json()
    const rawQs: any[] = json.questions ?? []

    // flat list → tree: parent_id 없는 것이 최상위, 있는 것이 소문제
    const childrenByParent = new Map<string, any[]>()
    const parentRows: any[] = []
    for (const q of rawQs) {
      if (q.parent_id) {
        if (!childrenByParent.has(q.parent_id)) childrenByParent.set(q.parent_id, [])
        childrenByParent.get(q.parent_id)!.push(q)
      } else {
        parentRows.push(q)
      }
    }
    parentRows.sort((a, b) => a.order_num - b.order_num)

    const loaded: QBQuestion[] = parentRows.map((q: any) => {
      if (q.question_type === 'group') {
        const kids = (childrenByParent.get(q.id) ?? []).sort((a: any, b: any) => a.order_num - b.order_num)
        const children: QBSubQuestion[] = kids.map((child: any) => ({
          id: child.id,
          clientId: Math.random().toString(36).slice(2),
          question_text: child.question_text ?? '',
          question_type: child.question_type ?? 'multiple_choice',
          score: String(child.score ?? 1),
          choices: child.question_type === 'multiple_choice'
            ? (child.choices ?? []).map((c: any) => c.choice_text ?? '')
            : ['', '', '', '', ''],
          correctChoiceIdxs: child.question_type === 'multiple_choice'
            ? (child.answers ?? []).map((a: any) => Math.max(0, parseInt(a.answer_text ?? '1') - 1))
            : [0],
          saAnswers: child.question_type === 'short_answer'
            ? (child.answers ?? []).map((a: any) => a.answer_text ?? '')
            : [''],
        }))
        return {
          id: q.id,
          clientId: Math.random().toString(36).slice(2),
          order_num: q.order_num,
          customLabel: q.custom_label ?? '',
          question_text: '',
          question_type: 'group' as const,
          score: '0',
          choices: [],
          correctChoiceIdxs: [0],
          saAnswers: [''],
          groupContext: q.group_context ?? '',
          children,
        }
      }
      return {
        id: q.id,
        clientId: Math.random().toString(36).slice(2),
        order_num: q.order_num,
        customLabel: q.custom_label ?? '',
        question_text: q.question_text ?? '',
        question_type: q.question_type ?? 'multiple_choice',
        score: String(q.score ?? 1),
        choices: q.question_type === 'multiple_choice'
          ? (q.choices ?? []).map((c: any) => c.choice_text ?? '')
          : ['', '', '', '', ''],
        correctChoiceIdxs: q.question_type === 'multiple_choice'
          ? (q.answers ?? []).map((a: any) => Math.max(0, parseInt(a.answer_text ?? '1') - 1))
          : [0],
        saAnswers: q.question_type === 'short_answer'
          ? (q.answers ?? []).map((a: any) => a.answer_text ?? '')
          : [''],
      }
    })
    setQuestions(loaded.length > 0 ? loaded : [newQ(1)])
    setLoadingSet(false)
  }

  function countEmptyMCAnswers(qs: QBQuestion[]) {
    return qs.reduce((acc, q) => {
      if (q.question_type === 'multiple_choice' && q.correctChoiceIdxs.length === 0) return acc + 1
      if (q.question_type === 'group')
        return acc + (q.children ?? []).filter(c => c.question_type === 'multiple_choice' && c.correctChoiceIdxs.length === 0).length
      return acc
    }, 0)
  }

  async function saveSet() {
    if (!editingSetId) return
    setSavingSet(true); setSavedSet(false)
    const token = await getToken()
    if (!token) { setSavingSet(false); return }

    const emptyCount = countEmptyMCAnswers(questions)
    if (emptyCount > 0) {
      const ok = await showAlert(`정답이 선택되지 않은 객관식 문제가 ${emptyCount}개 있어요.\n의도한 경우 그대로 저장돼요.`)
      if (!ok) { setSavingSet(false); return }
    }

    // 제목 저장
    const trimmedTitle = editingSetTitle.trim()
    if (trimmedTitle) {
      await fetch('/api/question-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'rename_set', id: editingSetId, title: trimmedTitle }),
      })
      setSets(prev => prev.map(s => s.id === editingSetId ? { ...s, title: trimmedTitle } : s))
    }

    const payload = questions.map((q, i) => {
      if (q.question_type === 'group') {
        return {
          order_num: i + 1,
          custom_label: q.customLabel.trim() || null,
          question_text: null,
          question_type: 'group',
          score: 0,
          group_context: q.groupContext?.trim() || null,
          choices: [],
          answers: [],
          children: (q.children ?? []).map((child, ci) => {
            if (child.question_type === 'multiple_choice') {
              return {
                order_num: ci + 1,
                question_text: child.question_text,
                question_type: 'multiple_choice',
                score: parseFloat(child.score) || 1,
                choices: child.choices.map((c, cj) => ({ choice_num: cj + 1, choice_text: c })),
                answers: child.correctChoiceIdxs.slice().sort((a, b) => a - b).map((idx, i) => ({ answer_text: String(idx + 1), order_num: i + 1 })),
              }
            }
            return {
              order_num: ci + 1,
              question_text: child.question_text,
              question_type: 'short_answer',
              score: parseFloat(child.score) || 1,
              choices: [],
              answers: child.saAnswers.filter(a => a.trim()).map((a, ai) => ({ answer_text: a, order_num: ai + 1 })),
            }
          }),
        }
      }
      const base = {
        order_num: i + 1,
        custom_label: q.customLabel.trim() || null,
        question_text: q.question_text,
        question_type: q.question_type,
        score: parseFloat(q.score) || 1,
      }
      if (q.question_type === 'multiple_choice') {
        return {
          ...base,
          choices: q.choices.map((c, ci) => ({ choice_num: ci + 1, choice_text: c })),
          answers: q.correctChoiceIdxs.slice().sort((a, b) => a - b).map((idx, i) => ({ answer_text: String(idx + 1), order_num: i + 1 })),
        }
      }
      return {
        ...base,
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
      void showAlert('저장에 실패했어요.')
    }
  }

  function updateQ(idx: number, updates: Partial<QBQuestion>) {
    setSavedSet(false)
    setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...updates } : q))
  }

  function insertQ(at: number) {
    setSavedSet(false)
    setQuestions(prev => {
      const next = [...prev]
      next.splice(at, 0, newQ(at + 1))
      return next
    })
  }

  async function openCreateExam() {
    if (!editingSetId || openingExam) return
    setOpeningExam(true)
    try {
    if (!savedSet) await saveSet()

    setSelectedQClientIds(new Set(questions.map(q => q.clientId)))
    setExamNumbering('original')
    setExamModalStep(1)
    setExamTitle(editingSetTitle)
    setSelectedClassId(null)
    setShowCreateExamModal(true)

    // 반 목록 로드
    setLoadingClasses(true)
    const { data: m } = await supabase.auth.getUser()
    const userId = m.user?.id
    if (!userId) { setLoadingClasses(false); return }
    const { data: teacherRow } = await supabase.from('academy_teachers').select('academy_id').eq('teacher_id', userId).single()
    const acadId = teacherRow?.academy_id
    if (!acadId) { setLoadingClasses(false); return }
    const { data: classData } = await supabase.from('classes').select('id, name').eq('academy_id', acadId).order('name')
    setClasses(classData ?? [])
    setLoadingClasses(false)
    } finally {
      setOpeningExam(false)
    }
  }

  async function doCreateExam() {
    if (!editingSetId || !selectedClassId || !examTitle.trim()) {
      void showAlert('반과 시험 이름을 입력해주세요.'); return
    }
    const selectedQs = questions.filter(q => selectedQClientIds.has(q.clientId))
    if (!selectedQs.length) { void showAlert('문제를 1개 이상 선택해주세요.'); return }

    const emptyCount = countEmptyMCAnswers(selectedQs)
    if (emptyCount > 0) {
      const ok = await showAlert(`정답이 선택되지 않은 객관식 문제가 ${emptyCount}개 있어요.\n의도한 경우 그대로 출제돼요.`)
      if (!ok) return
    }

    setCreatingExam(true)
    const token = await getToken()
    if (!token) { setCreatingExam(false); return }

    const examPayload = {
      classId: selectedClassId,
      title: examTitle.trim(),
      examType: 'auto',
      noDeadline: examNoDeadline,
      answerReveal: 'after_close',
      questions: selectedQs.map((q, i) => {
        const label = examNumbering === 'original'
          ? (q.customLabel.trim() || String(questions.indexOf(q) + 1))
          : null
        if (q.question_type === 'group') {
          return {
            orderNum: i + 1,
            label,
            questionType: 'group',
            score: 0,
            groupContext: q.groupContext ?? '',
            children: (q.children ?? []).map((child) => ({
              questionText: child.question_text,
              questionType: child.question_type,
              score: parseFloat(child.score) || 1,
              choices: child.question_type === 'multiple_choice'
                ? child.choices.map((c, ci) => ({ num: ci + 1, text: c }))
                : [],
              answers: child.question_type === 'multiple_choice'
                ? child.correctChoiceIdxs.map(i => String(i + 1))
                : child.saAnswers.filter(a => a.trim()),
            })),
          }
        }
        return {
          orderNum: i + 1,
          label,
          questionText: q.question_text,
          questionType: q.question_type,
          score: parseFloat(q.score) || 1,
          choices: q.question_type === 'multiple_choice'
            ? q.choices.map((c, ci) => ({ num: ci + 1, text: c }))
            : [],
          answers: q.question_type === 'multiple_choice'
            ? q.correctChoiceIdxs.map(i => String(i + 1))
            : q.saAnswers.filter(a => a.trim()),
        }
      }),
    }

    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(examPayload),
    })
    setCreatingExam(false)
    if (res.ok) {
      setShowCreateExamModal(false)
      void showAlert(`✅ "${examTitle.trim()}" 시험이 생성됐어요!\n시험 관리 탭 → 반별 시험에서 확인해보세요.`)
    } else {
      const err = await res.json().catch(() => ({}))
      void showAlert('시험 생성 실패: ' + (err.error ?? `HTTP ${res.status}`))
    }
  }

  // ── Render: Set Editor ─────────────────────────────────────────────────

  if (editingSetId) {
    const totalScore = questions.reduce((acc, q) => {
      if (q.question_type === 'group') {
        return acc + (q.children ?? []).reduce((s, c) => s + (parseFloat(c.score) || 0), 0)
      }
      return acc + (parseFloat(q.score) || 0)
    }, 0)
    return (
      <div className="space-y-4 pb-6">
        {dialog}
        {/* 헤더: 뒤로가기 / 제목 / 저장 / 시험생성 */}
        <div className="flex items-center gap-2">
          <button onClick={() => setEditingSetId(null)}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <input
              value={editingSetTitle}
              onChange={e => { setEditingSetTitle(e.target.value); setSavedSet(false) }}
              className="text-lg font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none w-full transition-colors"
            />
            <p className="text-xs text-slate-400">{questions.length}문제 · 총 {totalScore}점</p>
          </div>
          <button onClick={saveSet} disabled={savingSet}
            className={`flex items-center gap-1 px-3 py-2 text-sm font-semibold rounded-xl transition-colors flex-shrink-0 ${savedSet ? 'bg-emerald-100 text-emerald-700' : savingSet ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
            <Save size={14} />
            {savingSet ? '저장 중' : savedSet ? '저장됨 ✓' : '저장'}
          </button>
          <button onClick={openCreateExam} disabled={openingExam || savingSet}
            className={`flex items-center gap-1 px-3 py-2 text-sm font-semibold rounded-xl transition-colors flex-shrink-0 ${openingExam || savingSet ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            <GraduationCap size={14} /> {openingExam ? '준비 중...' : '시험 생성'}
          </button>
        </div>

        {/* 번호 수정 안내 */}
        <p className="text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2">
          💡 문제 왼쪽의 회색 번호 칸을 클릭하면 번호를 바꿀 수 있어요 (예: 3-1, A, ★)
        </p>

        {/* 문제 목록 */}
        <div className="space-y-3">
          {loadingSet ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 animate-pulse">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-7 bg-slate-100 rounded-lg" />
                  <div className="w-24 h-7 bg-slate-100 rounded-lg" />
                  <div className="ml-auto flex items-center gap-2">
                    <div className="w-14 h-7 bg-slate-100 rounded-lg" />
                    <div className="w-4 h-7 bg-slate-100 rounded-lg" />
                  </div>
                </div>
                <div className="w-full h-16 bg-slate-100 rounded-xl" />
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <div className="w-5 h-5 bg-slate-100 rounded-full" />
                      <div className="flex-1 h-5 bg-slate-100 rounded-lg" />
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            questions.map((q, i) => (
              <Fragment key={q.clientId}>
                <QuestionCard q={q} idx={i} total={questions.length}
                  onChange={u => updateQ(i, u)}
                  onRemove={() => { setSavedSet(false); setQuestions(prev => prev.filter((_, pi) => pi !== i)) }}
                  onDragStart={e => startDragQ(e, i)}
                  isDragging={dragQIdx === i}
                  isDragOver={dragQOverIdx === i}
                />
                {i < questions.length - 1 && (
                  <button onClick={() => insertQ(i + 1)}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 border-2 border-dashed border-slate-200 text-slate-300 hover:border-blue-400 hover:text-blue-400 rounded-2xl text-xs font-medium transition-colors">
                    <Plus size={13} /> 문제 삽입
                  </button>
                )}
              </Fragment>
            ))
          )}
        </div>

        {/* 문제 추가 버튼 */}
        <button
          onClick={() => { setSavedSet(false); setQuestions(prev => [...prev, newQ(prev.length + 1)]) }}
          className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-500 rounded-2xl text-sm font-medium transition-colors">
          <Plus size={16} /> 문제 추가
        </button>

        {/* ── 시험 생성 모달 ───────────────────────────────────────────── */}
        {showCreateExamModal && createPortal(
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-xl w-full max-w-md p-6 space-y-5 max-h-[90vh] overflow-y-auto">

              {/* 모달 헤더 */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">
                    {examModalStep === 1 ? '출제할 문제 선택' : '시험 설정'}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {examModalStep === 1 ? (() => {
                      const selectedQs = questions.filter(q => selectedQClientIds.has(q.clientId))
                      const totalScore = selectedQs.reduce((s, q) => {
                        if (q.question_type === 'group') return s + (q.children ?? []).reduce((cs, c) => cs + (parseFloat(c.score) || 0), 0)
                        return s + (parseFloat(q.score) || 0)
                      }, 0)
                      return `${selectedQClientIds.size} / ${questions.length}문제 선택됨 · 총 ${totalScore}점`
                    })() : '반과 시험 정보를 입력해주세요'}
                  </p>
                </div>
                <button onClick={() => setShowCreateExamModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>

              {/* ── STEP 1: 문제 선택 ── */}
              {examModalStep === 1 && (
                <>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedQClientIds(new Set(questions.map(q => q.clientId)))}
                      className="text-xs text-blue-600 font-semibold hover:underline">전체 선택</button>
                    <span className="text-slate-200">|</span>
                    <button onClick={() => setSelectedQClientIds(new Set())}
                      className="text-xs text-slate-400 font-medium hover:underline">전체 해제</button>
                  </div>

                  {/* 문제 체크박스 목록 */}
                  <div className="space-y-2">
                    {questions.map((q, i) => {
                      const label = displayLabel(q, i)
                      const checked = selectedQClientIds.has(q.clientId)
                      const isGroup = q.question_type === 'group'
                      const groupChildCount = isGroup ? (q.children ?? []).length : 0
                      const groupTotalScore = isGroup
                        ? (q.children ?? []).reduce((s, c) => s + (parseFloat(c.score) || 0), 0)
                        : 0
                      return (
                        <button key={q.clientId}
                          onClick={() => setSelectedQClientIds(prev => {
                            const next = new Set(prev)
                            next.has(q.clientId) ? next.delete(q.clientId) : next.add(q.clientId)
                            return next
                          })}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${checked ? (isGroup ? 'border-purple-400 bg-purple-50' : 'border-blue-400 bg-blue-50') : 'border-slate-200 hover:bg-slate-50'}`}>
                          <div className={`min-w-8 h-8 rounded-lg px-1 text-sm font-bold flex items-center justify-center flex-shrink-0 transition-colors ${checked ? (isGroup ? 'bg-purple-500 text-white' : 'bg-blue-500 text-white') : 'bg-slate-100 text-slate-500'}`}>
                            {label}
                          </div>
                          <div className="flex-1 min-w-0">
                            {isGroup ? (
                              <>
                                <p className="text-sm text-slate-700 truncate">
                                  {q.groupContext?.trim() || '(공통 지문 없음)'}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                  소문제 그룹 · {groupChildCount}개 소문제 · 총 {groupTotalScore}점
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="text-sm text-slate-700 truncate">
                                  {q.question_text || '(문제 내용 없음)'}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                  {q.question_type === 'multiple_choice' ? '객관식' : '주관식'} · {q.score}점
                                </p>
                              </>
                            )}
                          </div>
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${checked ? (isGroup ? 'bg-purple-500 border-purple-500' : 'bg-blue-500 border-blue-500') : 'border-slate-300'}`}>
                            {checked && <Check size={12} className="text-white" />}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {/* 번호 방식 */}
                  <div>
                    <p className="text-xs font-semibold text-slate-600 mb-2">시험에서 문제 번호 방식</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { val: 'original', label: '원래 번호 그대로', desc: '은행에서 설정한 번호 사용' },
                        { val: 'sequential', label: '1번부터 순서대로', desc: '선택한 순서로 1, 2, 3...' },
                      ] as const).map(({ val, label, desc }) => (
                        <button key={val} onClick={() => setExamNumbering(val)}
                          className={`py-3 px-3 rounded-xl border text-left transition-all ${examNumbering === val ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                          <p className={`text-xs font-semibold ${examNumbering === val ? 'text-blue-700' : 'text-slate-700'}`}>{label}</p>
                          <p className="text-[10px] text-slate-400 mt-1 leading-tight">{desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button onClick={() => setExamModalStep(2)} disabled={selectedQClientIds.size === 0}
                    className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm">
                    다음 → ({selectedQClientIds.size}문제 선택됨)
                  </button>
                </>
              )}

              {/* ── STEP 2: 시험 설정 ── */}
              {examModalStep === 2 && (
                <>
                  <button onClick={() => setExamModalStep(1)}
                    className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-700 font-medium">
                    <ChevronLeft size={14} /> 문제 선택으로
                  </button>

                  {/* 시험 이름 */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">시험 이름</label>
                    <input value={examTitle} onChange={e => setExamTitle(e.target.value)}
                      placeholder="시험 이름"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  </div>

                  {/* 반 선택 */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">반 선택</label>
                    {loadingClasses ? (
                      <p className="text-sm text-slate-400 py-2">불러오는 중...</p>
                    ) : classes.length === 0 ? (
                      <p className="text-sm text-slate-400 py-2">반이 없어요</p>
                    ) : (
                      <div className="space-y-1.5 max-h-44 overflow-y-auto">
                        {classes.map(c => (
                          <button key={c.id} onClick={() => setSelectedClassId(c.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all text-left ${selectedClassId === c.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${selectedClassId === c.id ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                              {c.name[0]}
                            </div>
                            <span className="flex-1">{c.name}</span>
                            {selectedClassId === c.id && <Check size={14} className="text-blue-500" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 마감 방식 */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">마감 방식</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { val: true, label: '마감 없음', desc: '제출 즉시 결과 확인' },
                        { val: false, label: '마감 있음', desc: '마감 후 결과 공개' },
                      ].map(({ val, label, desc }) => (
                        <button key={String(val)} onClick={() => setExamNoDeadline(val)}
                          className={`py-3 px-3 rounded-xl border text-left transition-all ${examNoDeadline === val ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                          <p className={`text-xs font-semibold ${examNoDeadline === val ? 'text-blue-700' : 'text-slate-700'}`}>{label}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button onClick={doCreateExam}
                    disabled={creatingExam || !selectedClassId || !examTitle.trim()}
                    className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm">
                    {creatingExam ? '생성 중...' : `시험 생성하기 (${selectedQClientIds.size}문제)`}
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
    )
  }

  // ── Render: 폴더 브라우저 ─────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {dialog}
      {/* 브레드크럼 */}
      <div className="flex items-center gap-1 flex-wrap">
        {breadcrumbs.map((b, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-slate-300" />}
            <button
              onClick={() => navigateBreadcrumb(b)}
              disabled={i === breadcrumbs.length - 1}
              className={`text-sm font-medium transition-colors ${i === breadcrumbs.length - 1 ? 'text-slate-800 cursor-default' : 'text-blue-500 hover:text-blue-700'}`}>
              {b.name}
            </button>
          </span>
        ))}
      </div>

      {/* 액션 버튼 */}
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

      {/* 새 폴더 입력 */}
      {creatingFolder && (
        <div className="flex items-center gap-2 bg-white border border-blue-300 rounded-2xl px-4 py-3">
          <Folder size={16} className="text-slate-400 flex-shrink-0" />
          <input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') } }}
            placeholder="폴더 이름"
            className="flex-1 text-sm text-slate-800 focus:outline-none" />
          <button onClick={createFolder} disabled={creating || !newFolderName.trim()} className="text-blue-600 hover:text-blue-800 disabled:opacity-40 transition-colors"><Check size={16} /></button>
          <button onClick={() => { setCreatingFolder(false); setNewFolderName('') }} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={16} /></button>
        </div>
      )}

      {/* 새 세트 입력 */}
      {creatingSet && (
        <div className="flex items-center gap-2 bg-white border border-blue-300 rounded-2xl px-4 py-3">
          <FileText size={16} className="text-blue-400 flex-shrink-0" />
          <input autoFocus value={newSetTitle} onChange={e => setNewSetTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createSet(); if (e.key === 'Escape') { setCreatingSet(false); setNewSetTitle('') } }}
            placeholder="세트 이름"
            className="flex-1 text-sm text-slate-800 focus:outline-none" />
          <button onClick={createSet} disabled={creating || !newSetTitle.trim()} className="text-blue-600 hover:text-blue-800 disabled:opacity-40 transition-colors"><Check size={16} /></button>
          <button onClick={() => { setCreatingSet(false); setNewSetTitle('') }} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={16} /></button>
        </div>
      )}

      {/* 상위 폴더로 내보내기 드롭존 — 항상 DOM에 존재, CSS만으로 표시/숨김 (조건부 렌더링하면 drag 끊김) */}
      {folderId !== null && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOverParentZone(true); setDragOverFolderIdForSet(null) }}
          onDragLeave={() => setDragOverParentZone(false)}
          onDrop={(e) => { e.preventDefault(); void handleMoveSetToParent(); setDragSetIdx(null); setDragOverParentZone(false) }}
          className={`items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed text-sm font-medium transition-all ${
            dragSetIdx !== null ? 'flex' : 'hidden'
          } ${
            dragOverParentZone
              ? 'border-orange-400 bg-orange-50 text-orange-600'
              : 'border-slate-300 text-slate-400'
          }`}
        >
          ↑ 여기에 놓으면 상위 폴더로 이동
        </div>
      )}

      {/* 콘텐츠 */}
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
          {folders.map((folder, i) => (
            <div
              key={folder.id}
              draggable={renamingId !== folder.id}
              onDragStart={() => setDragFolderIdx(i)}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragSetIdx !== null) setDragOverFolderIdForSet(folder.id)
                else setDragOverFolderIdx(i)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragSetIdx !== null) {
                  handleMoveSetIntoFolder(folder.id)
                } else {
                  handleFolderReorder(i)
                }
              }}
              onDragEnd={() => { setDragFolderIdx(null); setDragOverFolderIdx(null); setDragOverFolderIdForSet(null) }}
              className={`bg-white border rounded-2xl overflow-hidden transition-all ${
                dragFolderIdx === i ? 'opacity-40' : ''
              } ${
                dragOverFolderIdForSet === folder.id ? 'border-emerald-400 border-2 bg-emerald-50' :
                dragOverFolderIdx === i && dragFolderIdx !== i ? 'border-blue-400 border-2' :
                'border-slate-200'
              }`}
            >
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
                  <GripVertical size={16} className="text-slate-300 flex-shrink-0 hidden md:block" />
                  <div className="flex flex-col md:hidden flex-shrink-0">
                    <button onClick={() => moveFolderUp(i)} disabled={i === 0}
                      className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors p-0.5">
                      <ChevronUp size={13} />
                    </button>
                    <button onClick={() => moveFolderDown(i)} disabled={i === folders.length - 1}
                      className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors p-0.5">
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  <button onClick={() => enterFolder(folder)} className="flex items-center gap-3 flex-1 text-left">
                    <Folder size={18} className="text-amber-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-slate-700">{folder.name}</span>
                  </button>
                  <button onClick={e => { e.stopPropagation(); void openFolderMoveModal(folder.id) }}
                    className="md:hidden px-2 py-1 text-xs text-slate-400 hover:text-blue-500 rounded-lg transition-colors flex-shrink-0 font-medium">
                    이동
                  </button>
                  <button onClick={() => { setRenamingId(folder.id); setRenamingType('folder'); setRenameValue(folder.name) }}
                    className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => deleteItem('folder', folder.id, folder.name)}
                    className="p-1.5 text-slate-300 hover:text-red-400 rounded-lg transition-colors"><Trash2 size={14} /></button>
                  <ChevronRight size={16} className="text-slate-300" />
                </div>
              )}
            </div>
          ))}

          {sets.map((set, i) => (
            <div
              key={set.id}
              draggable={renamingId !== set.id}
              onDragStart={() => requestAnimationFrame(() => setDragSetIdx(i))}
              onDragOver={(e) => { e.preventDefault(); setDragOverSetIdx(i); setDragOverFolderIdForSet(null) }}
              onDrop={(e) => { e.preventDefault(); handleSetReorder(i) }}
              onDragEnd={() => { setDragSetIdx(null); setDragOverSetIdx(null); setDragOverFolderIdForSet(null); setDragOverParentZone(false) }}
              className={`bg-white border rounded-2xl overflow-hidden transition-all ${
                dragSetIdx === i ? 'opacity-40' : ''
              } ${
                dragOverSetIdx === i && dragSetIdx !== i ? 'border-blue-400 border-2' : 'border-slate-200'
              }`}
            >
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
                <div className="flex items-center gap-1 px-2 py-3 hover:bg-slate-50 transition-colors group">
                  <GripVertical size={16} className="text-slate-300 flex-shrink-0 mx-1 hidden md:block" />
                  <div className="flex flex-col md:hidden flex-shrink-0 ml-1">
                    <button onClick={() => moveSetUp(i)} disabled={i === 0}
                      className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors p-0.5">
                      <ChevronUp size={13} />
                    </button>
                    <button onClick={() => moveSetDown(i)} disabled={i === sets.length - 1}
                      className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors p-0.5">
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  <button onClick={() => openEditSet(set)} className="flex items-center gap-3 flex-1 text-left min-w-0">
                    <FileText size={18} className="text-blue-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-700">{set.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{set.questionCount}문제</p>
                    </div>
                  </button>
                  <button onClick={e => { e.stopPropagation(); void openMoveModal(set.id) }}
                    className="md:hidden px-2 py-1 text-xs text-slate-400 hover:text-blue-500 rounded-lg transition-colors flex-shrink-0 font-medium">
                    이동
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={e => { e.stopPropagation(); setRenamingId(set.id); setRenamingType('set'); setRenameValue(set.title) }}
                      className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg transition-colors"><Pencil size={14} /></button>
                    <button onClick={e => { e.stopPropagation(); deleteItem('set', set.id, set.title) }}
                      className="p-1.5 text-slate-300 hover:text-red-400 rounded-lg transition-colors"><Trash2 size={14} /></button>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 flex-shrink-0 mr-2" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 이동 모달 (모바일) — 세트/폴더 공용 */}
      {(movingSetId !== null || movingFolderId !== null) && createPortal(
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 sm:items-center sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-xl w-full sm:max-w-sm p-5 space-y-3 max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-800">어디로 이동할까요?</h2>
              <button onClick={() => { setMovingSetId(null); setMovingFolderId(null) }} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            {loadingAllFolders ? (
              <div className="flex justify-center py-6">
                <div className="w-5 h-5 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="overflow-y-auto space-y-1 flex-1">
                <button
                  onClick={() => void (movingFolderId ? doMoveFolder(null) : doMoveSet(null))}
                  disabled={folderId === null}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                    folderId === null ? 'opacity-40 cursor-default' : 'text-slate-700 hover:bg-slate-50'
                  }`}>
                  <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <BookOpen size={14} className="text-slate-500" />
                  </div>
                  <span>루트 (최상위)</span>
                  {folderId === null && <span className="ml-auto text-xs text-slate-400">현재 위치</span>}
                </button>
                {folderId !== null && (
                  <button
                    onClick={() => {
                      const parentId = breadcrumbs[breadcrumbs.length - 2]?.id ?? null
                      void (movingFolderId ? doMoveFolder(parentId) : doMoveSet(parentId))
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left text-slate-700 hover:bg-slate-50 transition-colors">
                    <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <ChevronUp size={14} className="text-blue-500" />
                    </div>
                    <span>상위 폴더로 꺼내기</span>
                    <span className="ml-1.5 text-xs text-slate-400">→ {breadcrumbs[breadcrumbs.length - 2]?.name ?? '루트'}</span>
                  </button>
                )}
                {allFolders
                  .filter(f => f.id !== movingFolderId)
                  .map(f => (
                    <button
                      key={f.id}
                      onClick={() => void (movingFolderId ? doMoveFolder(f.id) : doMoveSet(f.id))}
                      disabled={f.id === folderId}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                        f.id === folderId ? 'opacity-40 cursor-default' : 'text-slate-700 hover:bg-slate-50'
                      }`}>
                      <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                        <Folder size={14} className="text-amber-400" />
                      </div>
                      <span>{f.name}</span>
                      {f.id === folderId && <span className="ml-auto text-xs text-slate-400">현재 위치</span>}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
