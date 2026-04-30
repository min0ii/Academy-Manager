'use client'

import { useEffect, useState, Suspense } from 'react'
import {
  Plus, X, ChevronRight, ChevronLeft, Trash2, AlertTriangle,
  CheckCircle2, Circle, RefreshCw, ClipboardList, FileText,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAcademy } from '@/lib/academy-context'

// ── Types ──────────────────────────────────────────────────────────────────

type ClassItem = { id: string; name: string; examCount: number }

type ExamItem = {
  id: string
  title: string
  exam_type: 'manual' | 'auto'
  start_at: string | null
  end_at: string | null
  status: 'scheduled' | 'active' | 'closed'
  answer_reveal: 'immediate' | 'after_close'
  created_at: string
}

type ExamQuestion = {
  id: string
  order_num: number
  question_text: string | null
  question_type: 'multiple_choice' | 'short_answer'
  score: number
}

type ExamDetail = {
  exam: ExamItem
  questions: ExamQuestion[]
  choices: { id: string; question_id: string; choice_num: number; choice_text: string | null }[]
  answers: { id: string; question_id: string; answer_text: string; order_num: number }[]
}

type StudentSubmission = {
  studentId: string
  studentName: string
  submissionId: string | null
  isSubmitted: boolean
  submittedAt: string | null
  autoScore: number | null
  adjustedScore: number | null
  finalScore: number | null
  answers: {
    question_id: string
    student_answer: string | null
    is_correct: boolean | null
    score_earned: number | null
    manually_overridden: boolean
  }[]
}

type WizardQuestion = {
  clientId: string
  questionType: 'multiple_choice' | 'short_answer'
  questionText: string
  score: string
  choices: string[]
  correctChoiceIdx: number
  saAnswers: string[]
}

// ── Utilities ──────────────────────────────────────────────────────────────

function pct(score: number | null, max: number): number | null {
  if (score === null || max === 0) return null
  return Math.round((score / max) * 100)
}
function scoreColor(p: number | null) {
  if (p === null) return 'text-slate-400'
  if (p >= 80) return 'text-emerald-600'
  if (p >= 60) return 'text-amber-600'
  return 'text-red-500'
}
function scoreBg(p: number | null) {
  if (p === null) return 'bg-slate-50'
  if (p >= 80) return 'bg-emerald-50'
  if (p >= 60) return 'bg-amber-50'
  return 'bg-red-50'
}
function fmt(v: number | null): string {
  if (v === null) return '-'
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
function examStatus(exam: ExamItem): 'scheduled' | 'active' | 'closed' {
  if (exam.status === 'closed') return 'closed'
  const now = new Date()
  if (exam.start_at && new Date(exam.start_at) > now) return 'scheduled'
  if (exam.end_at && new Date(exam.end_at) < now) return 'closed'
  return 'active'
}
function statusLabel(s: 'scheduled' | 'active' | 'closed') {
  if (s === 'scheduled') return '예정'
  if (s === 'active') return '진행중'
  return '마감'
}
function statusColors(s: 'scheduled' | 'active' | 'closed') {
  if (s === 'scheduled') return 'bg-blue-100 text-blue-700'
  if (s === 'active') return 'bg-emerald-100 text-emerald-700'
  return 'bg-slate-100 text-slate-500'
}
function formatDT(dt: string | null) {
  if (!dt) return '-'
  const d = new Date(dt)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yy}/${mm}/${dd} ${hh}:${min}`
}
function newWizardQ(): WizardQuestion {
  return {
    clientId: Math.random().toString(36).slice(2),
    questionType: 'multiple_choice',
    questionText: '',
    score: '10',
    choices: ['', '', '', ''],
    correctChoiceIdx: 0,
    saAnswers: [''],
  }
}

// ── WizardQuestionCard ──────────────────────────────────────────────────────

function WizardQuestionCard({
  q, idx, total, onChange, onRemove,
}: {
  q: WizardQuestion
  idx: number
  total: number
  onChange: (u: Partial<WizardQuestion>) => void
  onRemove: () => void
}) {
  function updateChoice(ci: number, val: string) {
    const next = [...q.choices]; next[ci] = val; onChange({ choices: next })
  }
  function addChoice() {
    if (q.choices.length >= 5) return
    onChange({ choices: [...q.choices, ''] })
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
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center flex-shrink-0">
          {idx + 1}
        </span>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          {(['multiple_choice', 'short_answer'] as const).map((t, ti) => (
            <button key={t} onClick={() => onChange({ questionType: t })}
              className={`px-2.5 py-1.5 font-medium transition-colors ${ti > 0 ? 'border-l border-slate-200' : ''} ${q.questionType === t ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
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
          <button onClick={onRemove} className="text-slate-300 hover:text-red-400 transition-colors ml-1 flex-shrink-0">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Question text */}
      <textarea
        value={q.questionText}
        onChange={e => onChange({ questionText: e.target.value })}
        placeholder={`${idx + 1}번 문제 내용 (선택사항)`}
        rows={2}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-300"
      />

      {/* MC choices */}
      {q.questionType === 'multiple_choice' && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">선택지 — 정답을 체크하세요</p>
          {q.choices.map((text, ci) => (
            <div key={ci} className="flex items-center gap-2">
              <button
                onClick={() => onChange({ correctChoiceIdx: ci })}
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${q.correctChoiceIdx === ci ? 'border-blue-600 bg-blue-600' : 'border-slate-300 hover:border-blue-400'}`}>
                {q.correctChoiceIdx === ci && <div className="w-2 h-2 rounded-full bg-white" />}
              </button>
              <span className="text-xs text-slate-400 w-4 flex-shrink-0">{ci + 1}.</span>
              <input type="text" value={text} onChange={e => updateChoice(ci, e.target.value)}
                placeholder={`${ci + 1}번 선택지`}
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              {q.choices.length > 2 && (
                <button onClick={() => removeChoice(ci)} className="text-slate-300 hover:text-red-400 flex-shrink-0"><X size={14} /></button>
              )}
            </div>
          ))}
          {q.choices.length < 5 && (
            <button onClick={addChoice} className="text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1">
              <Plus size={12} /> 선택지 추가
            </button>
          )}
        </div>
      )}

      {/* SA answers */}
      {q.questionType === 'short_answer' && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">정답 (여러 개 입력 가능 — 대소문자 무시)</p>
          {q.saAnswers.map((ans, ai) => (
            <div key={ai} className="flex items-center gap-2">
              <input type="text" value={ans} onChange={e => updateSA(ai, e.target.value)}
                placeholder={ai === 0 ? '정답 입력' : '추가 인정 답안'}
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              {q.saAnswers.length > 1 && (
                <button onClick={() => onChange({ saAnswers: q.saAnswers.filter((_, i) => i !== ai) })}
                  className="text-slate-300 hover:text-red-400 flex-shrink-0"><X size={14} /></button>
              )}
            </div>
          ))}
          <button onClick={() => onChange({ saAnswers: [...q.saAnswers, ''] })}
            className="text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1">
            <Plus size={12} /> 인정 답안 추가
          </button>
        </div>
      )}
    </div>
  )
}

// ── ManualScoreView ─────────────────────────────────────────────────────────

function ManualScoreView({
  submissions, editScores, setEditScores, onSave, saving, saved, setSaved,
}: {
  submissions: StudentSubmission[]
  editScores: Record<string, string>
  setEditScores: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onSave: () => void
  saving: boolean
  saved: boolean
  setSaved: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const filled = submissions
    .filter(s => (editScores[s.studentId] ?? '') !== '')
    .map(s => Number(editScores[s.studentId]))
  const avg = filled.length > 0 ? filled.reduce((a, b) => a + b, 0) / filled.length : null
  const missing = submissions.filter(s => (editScores[s.studentId] ?? '') === '').length

  return (
    <div className="space-y-5">
      {filled.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[{ label: '평균', val: avg }, { label: '최고', val: Math.max(...filled) }, { label: '최저', val: Math.min(...filled) }].map(({ label, val }) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
              <p className="text-xs text-slate-400 mb-1">{label}</p>
              <p className="text-xl font-bold text-slate-800">{val !== null ? fmt(val) : '-'}<span className="text-sm font-normal text-slate-400">점</span></p>
            </div>
          ))}
        </div>
      )}

      {missing > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-700">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span><strong>{missing}명</strong>의 점수가 입력되지 않았어요</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-700">학생별 점수 입력</p>
          <button onClick={onSave} disabled={saving || saved}
            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${saved ? 'bg-emerald-100 text-emerald-700 cursor-default' : saving ? 'bg-blue-600 text-white opacity-50 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {saving ? '저장 중...' : saved ? '저장됨 ✓' : '저장'}
          </button>
        </div>
        {submissions.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">배정된 학생이 없어요</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {submissions.map(s => {
              const v = editScores[s.studentId] ?? ''
              return (
                <div key={s.studentId} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <span className="font-bold text-sm text-slate-500">{s.studentName[0]}</span>
                  </div>
                  <p className="flex-1 font-medium text-sm text-slate-800">{s.studentName}</p>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" value={v}
                      onChange={e => { setSaved(false); setEditScores(p => ({ ...p, [s.studentId]: e.target.value })) }}
                      placeholder="-" step="any" min="0"
                      className={`w-20 px-2 py-1.5 rounded-lg border text-sm text-slate-800 text-center focus:outline-none focus:ring-2 focus:border-transparent ${v === '' ? 'border-amber-300 bg-amber-50 focus:ring-amber-400' : 'border-slate-200 focus:ring-blue-500'}`}
                    />
                    <span className="text-xs text-slate-400">점</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── AutoMonitorView ─────────────────────────────────────────────────────────

function AutoMonitorView({
  examDetail, submissions, maxScore, submittedCount, avgScore,
  onRefresh, refreshing, lastRefresh, editAdjusted, setEditAdjusted,
  onSaveAdj, savingAdj, adjSaved, setAdjSaved, status,
}: {
  examDetail: ExamDetail | null
  submissions: StudentSubmission[]
  maxScore: number
  submittedCount: number
  avgScore: number | null
  onRefresh: () => void
  refreshing: boolean
  lastRefresh: Date | null
  editAdjusted: Record<string, string>
  setEditAdjusted: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onSaveAdj: () => void
  savingAdj: boolean
  adjSaved: boolean
  setAdjSaved: React.Dispatch<React.SetStateAction<boolean>>
  status: 'scheduled' | 'active' | 'closed'
}) {
  const totalStudents = submissions.length
  const avgP = pct(avgScore, maxScore)

  // Per-question wrong rate analysis
  const questionAnalysis = (examDetail?.questions ?? []).map(q => {
    const answered = submissions.filter(s => s.isSubmitted).map(s => s.answers.find(a => a.question_id === q.id))
    const total = answered.length
    const correct = answered.filter(a => a?.is_correct === true).length
    return { question: q, total, correct, wrongRate: total > 0 ? Math.round(((total - correct) / total) * 100) : null }
  })

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">제출</p>
          <p className="text-2xl font-bold text-slate-800">{submittedCount}<span className="text-sm font-normal text-slate-400">/{totalStudents}</span></p>
        </div>
        <div className={`rounded-2xl border border-slate-200 p-4 text-center ${scoreBg(avgP)}`}>
          <p className="text-xs text-slate-400 mb-1">평균</p>
          <p className={`text-2xl font-bold ${scoreColor(avgP)}`}>{avgScore !== null ? fmt(avgScore) : '-'}<span className="text-sm font-normal text-slate-400">점</span></p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">만점</p>
          <p className="text-2xl font-bold text-slate-800">{maxScore}<span className="text-sm font-normal text-slate-400">점</span></p>
        </div>
      </div>

      {/* Refresh */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{lastRefresh ? `${lastRefresh.toLocaleTimeString('ko-KR')} 기준` : ''}</p>
        <button onClick={onRefresh} disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? '새로고침 중...' : '새로고침'}
        </button>
      </div>

      {/* Student submission table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">제출 현황</p>
          {status === 'closed' && Object.keys(editAdjusted).length > 0 && (
            <button onClick={onSaveAdj} disabled={savingAdj || adjSaved}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${adjSaved ? 'bg-emerald-100 text-emerald-700 cursor-default' : savingAdj ? 'bg-blue-600 text-white opacity-50' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
              {savingAdj ? '저장 중...' : adjSaved ? '저장됨 ✓' : '조정 점수 저장'}
            </button>
          )}
        </div>
        <div className="divide-y divide-slate-100">
          {submissions.map(s => {
            const p = pct(s.finalScore, maxScore)
            const adjVal = editAdjusted[s.studentId] ?? (s.adjustedScore !== null ? String(s.adjustedScore) : '')
            return (
              <div key={s.studentId} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${s.isSubmitted ? scoreBg(p) : 'bg-slate-100'}`}>
                    <span className={`font-bold text-sm ${s.isSubmitted ? scoreColor(p) : 'text-slate-400'}`}>{s.studentName[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-800">{s.studentName}</p>
                    {s.isSubmitted && s.submittedAt && (
                      <p className="text-xs text-slate-400 mt-0.5">{formatDT(s.submittedAt)} 제출</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {s.isSubmitted ? (
                      <>
                        <div className="text-right">
                          <p className={`text-base font-bold ${scoreColor(p)}`}>{fmt(s.finalScore)}</p>
                          <p className="text-xs text-slate-400">/ {maxScore}점</p>
                        </div>
                        {status === 'closed' && s.submissionId && (
                          <div className="flex items-center gap-1">
                            <input type="number" value={adjVal}
                              onChange={e => { setAdjSaved(false); setEditAdjusted(prev => ({ ...prev, [s.studentId]: e.target.value })) }}
                              placeholder="조정" step="any"
                              className="w-16 px-2 py-1 rounded-lg border border-slate-200 text-xs text-slate-700 text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              title="조정 점수 (입력 후 저장 버튼 클릭)"
                            />
                          </div>
                        )}
                        <CheckCircle2 size={16} className="text-emerald-500" />
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <Circle size={16} />
                        <span className="text-xs">미제출</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Per-question color chips */}
                {s.isSubmitted && s.answers.length > 0 && examDetail && (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
                    {examDetail.questions.map((q, qi) => {
                      const ans = s.answers.find(a => a.question_id === q.id)
                      const ok = ans?.is_correct
                      return (
                        <div key={q.id}
                          title={`${qi + 1}번: ${ans?.student_answer ?? '미답'}`}
                          className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center cursor-default ${ok === true ? 'bg-emerald-100 text-emerald-600' : ok === false ? 'bg-red-100 text-red-500' : 'bg-slate-100 text-slate-400'}`}>
                          {qi + 1}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-question wrong rate */}
      {questionAnalysis.length > 0 && submittedCount > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700">문항별 오답률</p>
          </div>
          <div className="divide-y divide-slate-100">
            {questionAnalysis.map(({ question, total, correct, wrongRate }, qi) => {
              const wr = wrongRate ?? 0
              return (
                <div key={question.id} className="px-4 py-3 flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 text-sm font-bold flex items-center justify-center flex-shrink-0">
                    {qi + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    {question.question_text && (
                      <p className="text-xs text-slate-500 truncate mb-1.5">{question.question_text}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div className={`h-2 rounded-full transition-all ${wr >= 60 ? 'bg-red-400' : wr >= 30 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ width: `${wr}%` }} />
                      </div>
                      <span className={`text-xs font-semibold w-9 text-right flex-shrink-0 ${wr >= 60 ? 'text-red-500' : wr >= 30 ? 'text-amber-500' : 'text-emerald-600'}`}>
                        {wrongRate !== null ? `${wrongRate}%` : '-'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 text-xs text-slate-400">
                    <p>{correct}/{total} 정답</p>
                    <p>{question.score}점</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

function GradesContent() {
  const ctx = useAcademy()

  const [view, setView] = useState<'classes' | 'exams' | 'exam_detail'>('classes')
  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null)
  const [selectedExam, setSelectedExam] = useState<ExamItem | null>(null)

  // Class list
  const [classes, setClasses] = useState<ClassItem[]>([])
  const [loadingClasses, setLoadingClasses] = useState(true)

  // Exam list
  const [exams, setExams] = useState<ExamItem[]>([])
  const [loadingExams, setLoadingExams] = useState(false)

  // Exam detail
  const [examDetail, setExamDetail] = useState<ExamDetail | null>(null)
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Manual score editing
  const [editScores, setEditScores] = useState<Record<string, string>>({})
  const [savingScores, setSavingScores] = useState(false)
  const [scoresSaved, setScoresSaved] = useState(false)

  // Auto score adjustment
  const [editAdjusted, setEditAdjusted] = useState<Record<string, string>>({})
  const [savingAdj, setSavingAdj] = useState(false)
  const [adjSaved, setAdjSaved] = useState(false)

  // Close exam
  const [closing, setClosing] = useState(false)

  // Add exam modal: 'none' | 'type_select' | 'manual' | 'auto_1' | 'auto_2'
  const [addModal, setAddModal] = useState<'none' | 'type_select' | 'manual' | 'auto_1' | 'auto_2'>('none')

  // Manual form
  const [manualTitle, setManualTitle] = useState('')
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10))
  const [addingManual, setAddingManual] = useState(false)

  // Auto wizard
  const [autoTitle, setAutoTitle] = useState('')
  const [autoStartAt, setAutoStartAt] = useState('')
  const [autoEndAt, setAutoEndAt] = useState('')
  const [autoReveal, setAutoReveal] = useState<'immediate' | 'after_close'>('immediate')
  const [wizardQs, setWizardQs] = useState<WizardQuestion[]>([newWizardQ()])
  const [addingAuto, setAddingAuto] = useState(false)

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  useEffect(() => { if (ctx) loadClasses() }, [ctx])

  async function loadClasses() {
    if (!ctx) return
    setLoadingClasses(true)
    const { data: classData } = await supabase.from('classes').select('id, name').eq('academy_id', ctx.academyId).order('name')
    if (!classData?.length) { setClasses([]); setLoadingClasses(false); return }

    const { data: examData } = await supabase.from('exams').select('class_id').in('class_id', classData.map(c => c.id))
    const cnt = new Map<string, number>()
    for (const e of (examData ?? [])) cnt.set(e.class_id, (cnt.get(e.class_id) ?? 0) + 1)

    setClasses(classData.map(c => ({ id: c.id, name: c.name, examCount: cnt.get(c.id) ?? 0 })))
    setLoadingClasses(false)
  }

  async function selectClass(c: ClassItem) {
    setSelectedClass(c)
    setView('exams')
    await loadExams(c.id)
  }

  async function loadExams(classId: string) {
    setLoadingExams(true)
    const token = await getToken()
    if (!token) { setLoadingExams(false); return }
    const res = await fetch(`/api/exams?classId=${classId}`, { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()
    setExams(json.exams ?? [])
    setLoadingExams(false)
  }

  async function selectExam(exam: ExamItem) {
    setSelectedExam(exam)
    setView('exam_detail')
    setLoadingDetail(true)
    setExamDetail(null)
    setSubmissions([])
    setEditScores({})
    setEditAdjusted({})
    setScoresSaved(false)
    setAdjSaved(false)

    const token = await getToken()
    if (!token) { setLoadingDetail(false); return }

    if (exam.exam_type === 'auto') {
      const [detailRes, subRes] = await Promise.all([
        fetch(`/api/exams/${exam.id}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/exams/${exam.id}/submissions`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      setExamDetail(await detailRes.json())
      const subJson = await subRes.json()
      setSubmissions(subJson.students ?? [])
      setLastRefresh(new Date())
    } else {
      const subRes = await fetch(`/api/exams/${exam.id}/submissions`, { headers: { Authorization: `Bearer ${token}` } })
      const subJson = await subRes.json()
      const students: StudentSubmission[] = subJson.students ?? []
      setSubmissions(students)
      const init: Record<string, string> = {}
      for (const s of students) init[s.studentId] = s.finalScore !== null ? String(s.finalScore) : ''
      setEditScores(init)
    }
    setLoadingDetail(false)
  }

  async function refreshSubmissions() {
    if (!selectedExam) return
    setRefreshing(true)
    const token = await getToken()
    if (!token) { setRefreshing(false); return }
    const res = await fetch(`/api/exams/${selectedExam.id}/submissions`, { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()
    setSubmissions(json.students ?? [])
    setLastRefresh(new Date())
    setRefreshing(false)
  }

  async function addManualExam(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedClass || !manualTitle.trim()) return
    setAddingManual(true)
    const token = await getToken()
    if (!token) { setAddingManual(false); return }
    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        classId: selectedClass.id,
        title: manualTitle.trim(),
        examType: 'manual',
        startAt: manualDate ? `${manualDate}T00:00:00` : null,
        endAt: null,
        answerReveal: 'immediate',
        questions: [],
      }),
    })
    if (res.ok) {
      setManualTitle(''); setManualDate(new Date().toISOString().slice(0, 10))
      setAddModal('none')
      await loadExams(selectedClass.id)
    }
    setAddingManual(false)
  }

  async function addAutoExam() {
    if (!selectedClass) return
    setAddingAuto(true)
    const token = await getToken()
    if (!token) { setAddingAuto(false); return }

    const questions = wizardQs.map((q, idx) => {
      const score = parseFloat(q.score) || 0
      if (q.questionType === 'multiple_choice') {
        return {
          orderNum: idx + 1,
          questionText: q.questionText.trim() || null,
          questionType: 'multiple_choice',
          score,
          choices: q.choices.map((text, i) => ({ num: i + 1, text })),
          answers: [String(q.correctChoiceIdx + 1)],
        }
      }
      return {
        orderNum: idx + 1,
        questionText: q.questionText.trim() || null,
        questionType: 'short_answer',
        score,
        choices: [],
        answers: q.saAnswers.filter(a => a.trim()),
      }
    })

    const res = await fetch('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        classId: selectedClass.id,
        title: autoTitle.trim(),
        examType: 'auto',
        startAt: autoStartAt || null,
        endAt: autoEndAt || null,
        answerReveal: autoReveal,
        questions,
      }),
    })
    if (res.ok) {
      setAddModal('none')
      setAutoTitle(''); setAutoStartAt(''); setAutoEndAt('')
      setAutoReveal('immediate'); setWizardQs([newWizardQ()])
      await loadExams(selectedClass.id)
    }
    setAddingAuto(false)
  }

  async function deleteExam(examId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('이 시험을 삭제할까요? 모든 데이터가 삭제돼요.')) return
    const token = await getToken()
    if (!token) return
    await fetch(`/api/exams/${examId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    if (selectedExam?.id === examId) { setSelectedExam(null); setView('exams') }
    if (selectedClass) await loadExams(selectedClass.id)
  }

  async function closeExam() {
    if (!selectedExam) return
    if (!confirm('시험을 마감할까요? 미제출 학생은 현재 저장된 답안으로 자동 채점돼요.')) return
    setClosing(true)
    const token = await getToken()
    if (!token) { setClosing(false); return }
    const res = await fetch(`/api/exams/${selectedExam.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'close' }),
    })
    if (res.ok) {
      setSelectedExam(prev => prev ? { ...prev, status: 'closed' } : null)
      await refreshSubmissions()
    }
    setClosing(false)
  }

  async function saveManualScores() {
    if (!selectedExam) return
    setSavingScores(true)
    const token = await getToken()
    if (!token) { setSavingScores(false); return }
    const scores = submissions.map(s => ({
      studentId: s.studentId,
      score: (editScores[s.studentId] ?? '') !== '' ? Number(editScores[s.studentId]) : null,
    }))
    const res = await fetch(`/api/exams/${selectedExam.id}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ scores }),
    })
    setSavingScores(false)
    if (res.ok) setScoresSaved(true)
  }

  async function saveAdjustments() {
    if (!selectedExam) return
    setSavingAdj(true)
    const token = await getToken()
    if (!token) { setSavingAdj(false); return }
    const adjustments = submissions
      .filter(s => s.submissionId && editAdjusted[s.studentId] !== undefined)
      .map(s => ({
        submissionId: s.submissionId!,
        adjustedScore: editAdjusted[s.studentId] !== '' ? Number(editAdjusted[s.studentId]) : null,
      }))
    await fetch(`/api/exams/${selectedExam.id}/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ adjustments }),
    })
    setSavingAdj(false)
    setAdjSaved(true)
  }

  function updateWizardQ(idx: number, updates: Partial<WizardQuestion>) {
    setWizardQs(prev => prev.map((q, i) => i === idx ? { ...q, ...updates } : q))
  }

  function distributeScore() {
    const total = prompt(`총 배점을 입력하세요 (문제 수: ${wizardQs.length}개)`,
      String(wizardQs.reduce((s, q) => s + (parseFloat(q.score) || 0), 0) || 100))
    if (!total) return
    const n = parseFloat(total)
    if (isNaN(n) || n <= 0) return
    const per = Math.round((n / wizardQs.length) * 10) / 10
    setWizardQs(prev => prev.map(q => ({ ...q, score: String(per) })))
  }

  const maxScore = (examDetail?.questions ?? []).reduce((acc, q) => acc + Number(q.score), 0)
  const submittedCount = submissions.filter(s => s.isSubmitted).length
  const submittedWithScore = submissions.filter(s => s.isSubmitted && s.finalScore !== null)
  const avgScore = submittedWithScore.length > 0
    ? submittedWithScore.reduce((acc, s) => acc + (s.finalScore ?? 0), 0) / submittedWithScore.length
    : null

  const currentStatus = selectedExam ? examStatus(selectedExam) : 'scheduled'

  // ── RENDER: Class list ─────────────────────────────────────────────────

  if (view === 'classes') return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">시험 관리</h1>
        <p className="text-sm text-slate-500 mt-0.5">반을 선택해서 시험을 관리해요</p>
      </div>
      {loadingClasses ? (
        <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
      ) : classes.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg mb-1">등록된 반이 없어요</p>
          <p className="text-sm">수업 관리에서 반을 먼저 만들어주세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {classes.map(c => (
            <button key={c.id} onClick={() => selectClass(c)}
              className="w-full flex items-center gap-4 bg-white rounded-2xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all text-left">
              <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                <span className="text-blue-600 font-bold text-lg">{c.name[0]}</span>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-800">{c.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">시험 {c.examCount}개</p>
              </div>
              <ChevronRight size={16} className="text-slate-300" />
            </button>
          ))}
        </div>
      )}
    </div>
  )

  // ── RENDER: Exam list ──────────────────────────────────────────────────

  if (view === 'exams') return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => { setView('classes'); setSelectedClass(null) }}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-800">{selectedClass?.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">시험 목록</p>
        </div>
        <button onClick={() => setAddModal('type_select')}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors text-sm flex-shrink-0">
          <Plus size={16} /> 시험 추가
        </button>
      </div>

      {loadingExams ? (
        <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
      ) : exams.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg mb-1">아직 시험이 없어요</p>
          <p className="text-sm">시험 추가 버튼을 눌러 시험을 만들어보세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {exams.map(exam => {
            const st = examStatus(exam)
            return (
              <div key={exam.id} onClick={() => selectExam(exam)}
                className="flex items-center gap-4 bg-white rounded-2xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                  {exam.exam_type === 'auto'
                    ? <ClipboardList size={20} className="text-blue-500" />
                    : <FileText size={20} className="text-emerald-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="font-semibold text-slate-800">{exam.title}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColors(st)}`}>{statusLabel(st)}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 flex-shrink-0">
                      {exam.exam_type === 'auto' ? '자동채점' : '수동입력'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {exam.exam_type === 'auto'
                      ? `${formatDT(exam.start_at)} ~ ${formatDT(exam.end_at)}`
                      : exam.start_at ? formatDT(exam.start_at) : '날짜 미설정'}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={e => deleteExam(exam.id, e)}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-lg">
                    <Trash2 size={15} />
                  </button>
                  <ChevronRight size={16} className="text-slate-300" />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Type select modal ── */}
      {addModal === 'type_select' && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">시험 종류 선택</h2>
              <button onClick={() => setAddModal('none')} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3">
              <button onClick={() => setAddModal('manual')}
                className="w-full flex items-start gap-4 p-4 border-2 border-slate-200 hover:border-emerald-400 rounded-2xl transition-colors text-left">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <FileText size={18} className="text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-800">수동 입력</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">종이 시험 등 선생님이 직접 점수를 입력하는 방식이에요</p>
                </div>
              </button>
              <button onClick={() => setAddModal('auto_1')}
                className="w-full flex items-start gap-4 p-4 border-2 border-slate-200 hover:border-blue-400 rounded-2xl transition-colors text-left">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ClipboardList size={18} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-800">자동 채점</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">학생이 앱에서 직접 답을 입력하고 자동으로 채점되는 방식이에요</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual exam modal ── */}
      {addModal === 'manual' && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <button onClick={() => setAddModal('type_select')} className="text-slate-400 hover:text-slate-600">
                  <ChevronLeft size={18} />
                </button>
                <h2 className="font-bold text-slate-800">수동 입력 시험</h2>
              </div>
              <button onClick={() => setAddModal('none')} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <form onSubmit={addManualExam} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">시험 이름 *</label>
                <input type="text" value={manualTitle} onChange={e => setManualTitle(e.target.value)}
                  placeholder="예: 4월 단원평가" required autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">날짜 (선택)</label>
                <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setAddModal('type_select')}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">취소</button>
                <button type="submit" disabled={addingManual}
                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                  {addingManual ? '추가 중...' : '추가'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Auto exam wizard step 1 ── */}
      {addModal === 'auto_1' && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
              <div className="flex items-center gap-2">
                <button onClick={() => setAddModal('type_select')} className="text-slate-400 hover:text-slate-600"><ChevronLeft size={18} /></button>
                <div>
                  <h2 className="font-bold text-slate-800">자동 채점 시험</h2>
                  <p className="text-xs text-slate-400">1단계: 기본 정보</p>
                </div>
              </div>
              <button onClick={() => setAddModal('none')} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">시험 이름 *</label>
                <input type="text" value={autoTitle} onChange={e => setAutoTitle(e.target.value)}
                  placeholder="예: 5월 모의고사" autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">시작 시간 *</label>
                <input type="datetime-local" value={autoStartAt} onChange={e => setAutoStartAt(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">종료 시간 *</label>
                <input type="datetime-local" value={autoEndAt} onChange={e => setAutoEndAt(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">정답 공개 시점</label>
                <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                  {([{ val: 'immediate', label: '즉시 공개' }, { val: 'after_close', label: '마감 이후' }] as const).map(({ val, label }) => (
                    <button key={val} onClick={() => setAutoReveal(val)}
                      className={`flex-1 py-2.5 text-sm font-medium transition-colors ${autoReveal === val ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1.5">점수와 틀린 문항은 항상 공개돼요. 정답 내용 공개 시점을 설정해요.</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setAddModal('none')}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">취소</button>
                <button onClick={() => {
                  if (!autoTitle.trim() || !autoStartAt || !autoEndAt) {
                    alert('시험 이름과 시작/종료 시간을 입력해주세요.')
                    return
                  }
                  setAddModal('auto_2')
                }}
                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors">
                  다음: 문제 설정 →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Auto exam wizard step 2 ── */}
      {addModal === 'auto_2' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white sm:items-center sm:justify-center sm:bg-black/40 sm:px-4">
          <div className="bg-white sm:rounded-2xl w-full sm:max-w-2xl flex flex-col h-full sm:h-auto sm:max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                <button onClick={() => setAddModal('auto_1')} className="text-slate-400 hover:text-slate-600"><ChevronLeft size={18} /></button>
                <div>
                  <h2 className="font-bold text-slate-800 text-sm truncate max-w-[200px]">{autoTitle}</h2>
                  <p className="text-xs text-slate-400">2단계: 문제 설정</p>
                </div>
              </div>
              <button onClick={() => setAddModal('none')} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {wizardQs.map((q, idx) => (
                <WizardQuestionCard key={q.clientId} q={q} idx={idx} total={wizardQs.length}
                  onChange={updates => updateWizardQ(idx, updates)}
                  onRemove={() => setWizardQs(prev => prev.filter((_, i) => i !== idx))}
                />
              ))}
              <button onClick={() => setWizardQs(prev => [...prev, newWizardQ()])}
                className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                <Plus size={16} /> 문제 추가
              </button>
            </div>
            <div className="p-5 border-t border-slate-100 flex-shrink-0 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">
                  총 {wizardQs.length}문제 · 총점 {wizardQs.reduce((s, q) => s + (parseFloat(q.score) || 0), 0)}점
                </span>
                <button onClick={distributeScore} className="text-xs text-blue-500 hover:text-blue-700 font-medium">배점 균등 분배</button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setAddModal('none')}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">취소</button>
                <button onClick={addAutoExam} disabled={addingAuto}
                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                  {addingAuto ? '생성 중...' : '시험 생성'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // ── RENDER: Exam detail ────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => { setView('exams'); setSelectedExam(null); setExamDetail(null); setSubmissions([]) }}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h1 className="text-xl font-bold text-slate-800 truncate">{selectedExam?.title}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColors(currentStatus)}`}>
              {statusLabel(currentStatus)}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {selectedExam?.exam_type === 'auto'
              ? `${formatDT(selectedExam.start_at)} ~ ${formatDT(selectedExam.end_at)}`
              : selectedExam?.start_at ? formatDT(selectedExam.start_at) : '날짜 미설정'}
          </p>
        </div>
        {selectedExam?.exam_type === 'auto' && currentStatus !== 'closed' && (
          <button onClick={closeExam} disabled={closing}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 flex-shrink-0">
            {closing ? '마감 중...' : '조기 마감'}
          </button>
        )}
      </div>

      {loadingDetail ? (
        <div className="text-center py-16 text-slate-400 text-sm">불러오는 중...</div>
      ) : selectedExam?.exam_type === 'manual' ? (
        <ManualScoreView
          submissions={submissions}
          editScores={editScores}
          setEditScores={setEditScores}
          onSave={saveManualScores}
          saving={savingScores}
          saved={scoresSaved}
          setSaved={setScoresSaved}
        />
      ) : (
        <AutoMonitorView
          examDetail={examDetail}
          submissions={submissions}
          maxScore={maxScore}
          submittedCount={submittedCount}
          avgScore={avgScore}
          onRefresh={refreshSubmissions}
          refreshing={refreshing}
          lastRefresh={lastRefresh}
          editAdjusted={editAdjusted}
          setEditAdjusted={setEditAdjusted}
          onSaveAdj={saveAdjustments}
          savingAdj={savingAdj}
          adjSaved={adjSaved}
          setAdjSaved={setAdjSaved}
          status={currentStatus}
        />
      )}
    </div>
  )
}

export default function GradesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400 text-sm">불러오는 중...</div>}>
      <GradesContent />
    </Suspense>
  )
}
