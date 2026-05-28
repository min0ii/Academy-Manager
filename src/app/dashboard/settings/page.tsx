'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAcademy } from '@/lib/academy-context'
import {
  Building2, User, Check, X,
  Eye, EyeOff, Loader2, Camera, ShieldQuestion, Sparkles, Heart,
  Zap, Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw, GripVertical,
} from 'lucide-react'

type Tab = 'academy' | 'profile' | 'fun'
type Title = '원장' | '관리자' | '강사' | '조교'
type ConditionType = 'attendance' | 'exam_score' | 'homework' | 'clinic'
type LivesRule = {
  id: string
  name: string
  condition_type: ConditionType
  condition_detail: Record<string, unknown>
  delta: number
  enabled: boolean
}

const COND_LABEL: Record<ConditionType, string> = {
  attendance: '출결',
  exam_score: '시험',
  homework:   '과제',
  clinic:     '클리닉',
}
const ATT_STATUS_LABEL: Record<string, string> = { present: '출석', late: '지각', early_leave: '조퇴', absent: '결석' }
const HW_STATUS_LABEL  = { done: '완료', partial: '오답(완벽) 완료', none: '미완료', unrecorded: '미기록' }
const CLINIC_STATUS_LABEL = { done: '완료', not_done: '미완료' }
const OPERATOR_LABEL = { lt: '미만', lte: '이하', gte: '이상', gt: '초과' }

function ruleDescription(rule: LivesRule): string {
  const d = rule.condition_detail
  const deltaStr = rule.delta > 0 ? `+${rule.delta}` : `${rule.delta}`
  if (rule.condition_type === 'attendance') {
    const statuses = Array.isArray(d.statuses)
      ? (d.statuses as string[])
      : (d.status ? [d.status as string] : [])
    const statusStr = statuses.map(s => ATT_STATUS_LABEL[s] ?? s).join('/') + '하면'
    return `${statusStr} 목숨 ${deltaStr}`
  }
  if (rule.condition_type === 'homework')
    return `과제 ${HW_STATUS_LABEL[d.status as keyof typeof HW_STATUS_LABEL] ?? d.status}이면 목숨 ${deltaStr}`
  if (rule.condition_type === 'clinic')
    return `클리닉 ${CLINIC_STATUS_LABEL[d.status as keyof typeof CLINIC_STATUS_LABEL] ?? d.status}이면 목숨 ${deltaStr}`
  if (rule.condition_type === 'exam_score') {
    const catStr = d.category ? ` [${d.category}]` : ''
    const examSubType = (d.examSubType as string) ?? 'score'
    if (examSubType === 'not_submitted') return `시험${catStr} 미제출이면 목숨 ${deltaStr}`
    if (examSubType === 'pass_fail')
      return `시험${catStr} ${d.result === 'pass' ? '통과' : '불통'}이면 목숨 ${deltaStr}`
    const scoreType = (d.scoreType as string) ?? 'pct'
    const unit = scoreType === 'raw' ? '점' : '%'
    return `시험${catStr} ${d.value}${unit} ${OPERATOR_LABEL[d.operator as keyof typeof OPERATOR_LABEL] ?? d.operator}이면 목숨 ${deltaStr}`
  }
  return `목숨 ${deltaStr}`
}

const COND_ICON: Record<ConditionType, string> = {
  attendance: '📋',
  exam_score: '📝',
  homework:   '📚',
  clinic:     '🏥',
}

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

  // 재밌는 기능 — 목숨
  const [livesEnabled, setLivesEnabled] = useState(false)
  const [livesDefault, setLivesDefault] = useState(3)
  const [livesLoaded, setLivesLoaded]   = useState(false)
  const [savingLives, setSavingLives]   = useState(false)
  const [livesSaved, setLivesSaved]     = useState(false)

  // 목숨 자동화
  const [livesAutoEnabled, setLivesAutoEnabled] = useState(false)
  const [livesAutoFrom, setLivesAutoFrom]       = useState('')
  const [livesRules, setLivesRules]             = useState<LivesRule[]>([])
  const [rulesLoaded, setRulesLoaded]           = useState(false)
  const [savingAuto, setSavingAuto]             = useState(false)
  const [autoSaved, setAutoSaved]               = useState(false)
  const [recalculating, setRecalculating]       = useState(false)
  const [manualRecalculating, setManualRecalculating] = useState(false)
  const [manualRecalcDone, setManualRecalcDone]       = useState(false)
  const [draggingId, setDraggingId]                   = useState<string | null>(null)
  const [dragOverId, setDragOverId]                   = useState<string | null>(null)
  // 규칙 추가 폼
  const [showRuleForm, setShowRuleForm]           = useState(false)
  const [formType, setFormType]                   = useState<ConditionType>('attendance')
  const [formAttStatuses, setFormAttStatuses]     = useState<Set<string>>(new Set(['absent']))
  const [formHwStatus, setFormHwStatus]           = useState<'done'|'partial'|'none'|'unrecorded'>('none')
  const [formClinicStatus, setFormClinicStatus]   = useState<'done'|'not_done'>('not_done')
  const [formExamSubType, setFormExamSubType]     = useState<'score'|'pass_fail'|'not_submitted'>('score')
  const [formPassFailResult, setFormPassFailResult] = useState<'pass'|'fail'>('fail')
  const [formScoreOp, setFormScoreOp]             = useState<'lt'|'lte'|'gte'|'gt'>('lt')
  const [formScoreVal, setFormScoreVal]           = useState(70)
  const [formScoreType, setFormScoreType]         = useState<'pct'|'raw'>('pct')
  const [formScoreCat, setFormScoreCat]           = useState('')
  const [formDelta, setFormDelta]                 = useState(-1)
  const [savingRule, setSavingRule]               = useState(false)
  const [examCategories, setExamCategories]       = useState<string[]>([])

  // 보안 질문
  const [currentSQ, setCurrentSQ]     = useState<string | null>(null)
  const [sqLoaded, setSqLoaded]       = useState(false)
  const [showSqModal, setShowSqModal] = useState(false)
  const [sqQuestion, setSqQuestion]   = useState('')
  const [sqAnswer, setSqAnswer]       = useState('')
  const [sqSaving, setSqSaving]       = useState(false)
  const [sqSaved, setSqSaved]         = useState(false)
  const [sqError, setSqError]         = useState('')

  // 설정 변경 시 '저장됨' 상태 초기화
  useEffect(() => { setLivesSaved(false) }, [livesEnabled, livesDefault])
  useEffect(() => { setAutoSaved(false) }, [livesAutoEnabled, livesAutoFrom])

  const ctx = useAcademy()
  useEffect(() => {
    if (!ctx) return
    setMyId(ctx.userId)
    setAcademyId(ctx.academyId)
    setMyRole(ctx.myRole)
    setMyTitle(ctx.myTitle as Title)
    setMyName(ctx.teacherName)
    setAcademyName(ctx.academyName)
    setAcademyLogoUrl(ctx.academyLogoUrl)
    setLoading(false)
    loadSecurityQuestion(ctx.userId)
    loadLivesSettings(ctx.academyId)
    loadAutoRules(ctx.academyId)
    loadExamCategories(ctx.academyId)
  }, [ctx])

  async function loadLivesSettings(aId: string) {
    const { data } = await supabase.from('academies')
      .select('lives_enabled, lives_default').eq('id', aId).single()
    setLivesEnabled(data?.lives_enabled ?? false)
    setLivesDefault(data?.lives_default ?? 3)
    setLivesLoaded(true)
  }

  async function loadAutoRules(aId: string) {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return
    const res = await fetch(`/api/lives?action=rules&academyId=${aId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const json = await res.json()
    setLivesAutoEnabled(json.livesAutoEnabled ?? false)
    setLivesAutoFrom(json.livesAutoFrom ?? '')
    setLivesRules(json.rules ?? [])
    setRulesLoaded(true)
  }

  async function loadExamCategories(aId: string) {
    const { data: classes } = await supabase.from('classes').select('id').eq('academy_id', aId)
    if (!classes || classes.length === 0) return
    const classIds = classes.map(c => c.id)
    const { data: exams } = await supabase
      .from('exams').select('category')
      .in('class_id', classIds)
      .not('category', 'is', null)
    const cats = [...new Set((exams ?? []).map(e => e.category).filter(Boolean))] as string[]
    setExamCategories(cats)
  }

  async function saveAutoSettings() {
    setSavingAuto(true)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setSavingAuto(false); return }
    const res = await fetch('/api/lives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'save-auto-settings',
        academyId,
        livesAutoEnabled,
        livesAutoFrom: livesAutoFrom || null,
      }),
    })
    const json = await res.json()
    setSavingAuto(false)
    if (res.ok) {
      setAutoSaved(true)
      setTimeout(() => setAutoSaved(false), 2000)
      if (json.recalculating) {
        setRecalculating(true)
        setTimeout(() => setRecalculating(false), 3000)
      }
    }
  }

  async function reorderRules(ruleIds: string[]) {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return
    await fetch('/api/lives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'reorder-rules', ruleIds }),
    })
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) { setDraggingId(null); setDragOverId(null); return }
    const newOrder = [...livesRules]
    const fromIdx = newOrder.findIndex(r => r.id === draggingId)
    const toIdx   = newOrder.findIndex(r => r.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return
    newOrder.splice(toIdx, 0, newOrder.splice(fromIdx, 1)[0])
    setLivesRules(newOrder)
    reorderRules(newOrder.map(r => r.id))
    setDraggingId(null)
    setDragOverId(null)
  }

  async function manualRecalculate() {
    setManualRecalculating(true)
    setManualRecalcDone(false)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setManualRecalculating(false); return }
    await fetch('/api/lives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'recalculate', academyId }),
    })
    setManualRecalculating(false)
    setManualRecalcDone(true)
    setTimeout(() => setManualRecalcDone(false), 3000)
  }

  function resetRuleForm() {
    setFormType('attendance')
    setFormAttStatuses(new Set(['absent']))
    setFormHwStatus('none')
    setFormClinicStatus('not_done')
    setFormExamSubType('score')
    setFormPassFailResult('fail')
    setFormScoreOp('lt')
    setFormScoreVal(70)
    setFormScoreType('pct')
    setFormScoreCat('')
    setFormDelta(-1)
  }

  function buildConditionDetail(): Record<string, unknown> {
    if (formType === 'attendance') return { statuses: [...formAttStatuses] }
    if (formType === 'homework')   return { status: formHwStatus }
    if (formType === 'clinic')     return { status: formClinicStatus }
    if (formExamSubType === 'not_submitted') return {
      examSubType: 'not_submitted',
      category: formScoreCat || null,
    }
    if (formExamSubType === 'pass_fail') return {
      examSubType: 'pass_fail',
      result: formPassFailResult,
      category: formScoreCat || null,
    }
    return {
      examSubType: 'score',
      operator: formScoreOp,
      value: formScoreVal,
      scoreType: formScoreType,
      category: formScoreCat || null,
    }
  }

  function buildRuleName(): string {
    const d = buildConditionDetail()
    const deltaStr = formDelta > 0 ? `+${formDelta}` : `${formDelta}`
    if (formType === 'attendance') {
      const statuses = (d.statuses as string[]) ?? []
      return `${statuses.map(s => ATT_STATUS_LABEL[s] ?? s).join('/')}하면 ${deltaStr}`
    }
    if (formType === 'homework')
      return `과제 ${HW_STATUS_LABEL[d.status as keyof typeof HW_STATUS_LABEL]}이면 ${deltaStr}`
    if (formType === 'clinic')
      return `클리닉 ${CLINIC_STATUS_LABEL[d.status as keyof typeof CLINIC_STATUS_LABEL]}이면 ${deltaStr}`
    const catStr = d.category ? ` [${d.category}]` : ''
    if (formExamSubType === 'not_submitted') return `시험${catStr} 미제출이면 ${deltaStr}`
    if (formExamSubType === 'pass_fail')
      return `시험${catStr} ${formPassFailResult === 'pass' ? '통과' : '불통'}이면 ${deltaStr}`
    return `시험${catStr} ${d.value}${formScoreType === 'raw' ? '점' : '%'} ${OPERATOR_LABEL[d.operator as keyof typeof OPERATOR_LABEL]}이면 ${deltaStr}`
  }

  async function addRule() {
    setSavingRule(true)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setSavingRule(false); return }
    const res = await fetch('/api/lives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'create-rule',
        academyId,
        name: buildRuleName(),
        condition_type: formType,
        condition_detail: buildConditionDetail(),
        delta: formDelta,
      }),
    })
    const json = await res.json()
    setSavingRule(false)
    if (res.ok && json.rule) {
      setLivesRules(prev => [...prev, json.rule])
      setShowRuleForm(false)
      resetRuleForm()
    }
  }

  async function toggleRule(ruleId: string, enabled: boolean) {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return
    await fetch('/api/lives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'update-rule', ruleId, enabled }),
    })
    setLivesRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r))
  }

  async function deleteRule(ruleId: string) {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return
    await fetch('/api/lives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'delete-rule', ruleId }),
    })
    setLivesRules(prev => prev.filter(r => r.id !== ruleId))
  }

  async function saveLivesSettings() {
    setSavingLives(true)
    await supabase.from('academies').update({
      lives_enabled: livesEnabled,
      lives_default: livesDefault,
    }).eq('id', academyId)
    setSavingLives(false)
    setLivesSaved(true)
    setTimeout(() => setLivesSaved(false), 2000)
  }

  async function loadSecurityQuestion(userId: string) {
    const { data } = await supabase
      .from('profiles').select('security_question').eq('id', userId).single()
    setCurrentSQ(data?.security_question ?? null)
    setSqLoaded(true)
  }

  async function handleSaveSQ(e: React.FormEvent) {
    e.preventDefault()
    setSqError('')
    if (!sqQuestion.trim()) { setSqError('질문을 입력해주세요.'); return }
    if (!sqAnswer.trim()) { setSqError('답변을 입력해주세요.'); return }
    setSqSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setSqSaving(false); return }
    const res = await fetch('/api/security-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question: sqQuestion.trim(), answer: sqAnswer.trim() }),
    })
    const json = await res.json()
    setSqSaving(false)
    if (!res.ok) { setSqError(json.error ?? '오류가 발생했어요.'); return }
    setCurrentSQ(sqQuestion.trim())
    setSqSaved(true)
    setTimeout(() => {
      setShowSqModal(false); setSqSaved(false)
      setSqQuestion(''); setSqAnswer('')
    }, 1500)
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
    { key: 'profile', label: '내 정보',   Icon: User },
    { key: 'fun',     label: '재밌는 기능', Icon: Sparkles },
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

      {/* 규칙 추가 모달 */}
      {showRuleForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
              <div className="flex items-center gap-2">
                <Zap size={18} className="text-violet-500" />
                <h2 className="font-bold text-slate-800">규칙 추가</h2>
              </div>
              <button onClick={() => setShowRuleForm(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-5">
              {/* 유형 선택 */}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2">조건 유형</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['attendance', 'homework', 'clinic', 'exam_score'] as ConditionType[]).map(t => (
                    <button
                      key={t}
                      onClick={() => setFormType(t)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                        formType === t
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-violet-50'
                      }`}
                    >
                      <span>{COND_ICON[t]}</span> {COND_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 조건 상세 */}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2">세부 조건</p>

                {formType === 'attendance' && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-400">복수 선택 가능해요</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['absent', 'late', 'early_leave', 'present'] as const).map(s => {
                        const checked = formAttStatuses.has(s)
                        return (
                          <button key={s}
                            onClick={() => setFormAttStatuses(prev => {
                              const n = new Set(prev)
                              n.has(s) ? n.delete(s) : n.add(s)
                              return n
                            })}
                            className={`py-2 rounded-xl border text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                              checked ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-violet-50'
                            }`}>
                            {checked && <Check size={12} />}
                            {ATT_STATUS_LABEL[s]}
                          </button>
                        )
                      })}
                    </div>
                    {formAttStatuses.size === 0 && (
                      <p className="text-xs text-red-400">하나 이상 선택해주세요</p>
                    )}
                  </div>
                )}

                {formType === 'homework' && (
                  <div className="grid grid-cols-2 gap-2">
                    {(['none', 'done', 'partial', 'unrecorded'] as const).map(s => (
                      <button key={s} onClick={() => setFormHwStatus(s)}
                        className={`py-2 rounded-xl border text-sm font-medium transition-colors ${
                          formHwStatus === s ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-violet-50'
                        }`}>
                        {HW_STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                )}

                {formType === 'clinic' && (
                  <div className="grid grid-cols-2 gap-2">
                    {(['not_done', 'done'] as const).map(s => (
                      <button key={s} onClick={() => setFormClinicStatus(s)}
                        className={`py-2 rounded-xl border text-sm font-medium transition-colors ${
                          formClinicStatus === s ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-violet-50'
                        }`}>
                        {CLINIC_STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                )}

                {formType === 'exam_score' && (
                  <div className="space-y-3">
                    {/* 시험 유형 */}
                    <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm">
                      {(['score', 'pass_fail', 'not_submitted'] as const).map((t, i) => (
                        <button key={t} onClick={() => setFormExamSubType(t)}
                          className={`flex-1 py-2 font-medium transition-colors ${i > 0 ? 'border-l border-slate-200' : ''} ${
                            formExamSubType === t ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-violet-50'
                          }`}>
                          {t === 'score' ? '점수형' : t === 'pass_fail' ? '통과·불통형' : '미제출'}
                        </button>
                      ))}
                    </div>

                    {/* 카테고리 */}
                    <div>
                      <p className="text-xs text-slate-500 mb-1.5">시험 카테고리 (선택)</p>
                      <select
                        value={formScoreCat}
                        onChange={e => setFormScoreCat(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                      >
                        <option value="">전체 카테고리</option>
                        {examCategories.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    {formExamSubType === 'not_submitted' ? null : formExamSubType === 'pass_fail' ? (
                      /* 통과/불통 선택 */
                      <div className="grid grid-cols-2 gap-2">
                        {(['fail', 'pass'] as const).map(r => (
                          <button key={r} onClick={() => setFormPassFailResult(r)}
                            className={`py-2 rounded-xl border text-sm font-semibold transition-colors ${
                              formPassFailResult === r
                                ? r === 'pass' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-red-500 text-white border-red-500'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}>
                            {r === 'pass' ? '✅ 통과' : '❌ 불통'}
                          </button>
                        ))}
                      </div>
                    ) : (
                      /* 점수 조건 */
                      <div className="space-y-2">
                        {/* 점수 단위 토글 */}
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-slate-500 flex-1">점수 기준</p>
                          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                            {(['pct', 'raw'] as const).map((t, i) => (
                              <button key={t} onClick={() => setFormScoreType(t)}
                                className={`px-3 py-1.5 font-semibold transition-colors ${i > 0 ? 'border-l border-slate-200' : ''} ${
                                  formScoreType === t ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                                }`}>
                                {t === 'pct' ? '%' : '원점수'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 items-center">
                          <select
                            value={formScoreOp}
                            onChange={e => setFormScoreOp(e.target.value as 'lt'|'lte'|'gte'|'gt')}
                            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                          >
                            {(['lt','lte','gte','gt'] as const).map(op => (
                              <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={0}
                            max={formScoreType === 'pct' ? 100 : undefined}
                            value={formScoreVal}
                            onChange={e => setFormScoreVal(Number(e.target.value))}
                            className="w-20 px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-400"
                          />
                          <span className="text-sm text-slate-500 flex-shrink-0">{formScoreType === 'pct' ? '%' : '점'}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 목숨 변화 */}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2">목숨 변화</p>
                <div className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3">
                  <button
                    onClick={() => setFormDelta(v => v - 1)}
                    className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-red-50 hover:border-red-300 hover:text-red-500 transition-colors text-lg font-bold"
                  >−</button>
                  <div className="flex-1 text-center">
                    <span className={`text-2xl font-bold ${formDelta > 0 ? 'text-emerald-600' : formDelta < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {formDelta > 0 ? `+${formDelta}` : formDelta}
                    </span>
                  </div>
                  <button
                    onClick={() => setFormDelta(v => v + 1)}
                    className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-green-50 hover:border-green-300 hover:text-green-600 transition-colors text-lg font-bold"
                  >+</button>
                </div>
              </div>

              {/* 미리보기 */}
              <div className="bg-violet-50 rounded-xl px-4 py-3">
                <p className="text-xs text-violet-500 mb-1">규칙 미리보기</p>
                <p className="text-sm font-semibold text-violet-800">
                  {formDelta > 0 ? `+${formDelta}` : formDelta}개 — {ruleDescription({
                    id: '', name: '', condition_type: formType,
                    condition_detail: buildConditionDetail(),
                    delta: formDelta, enabled: true,
                  })}
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowRuleForm(false)}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl text-sm">취소</button>
                <button
                  onClick={addRule}
                  disabled={savingRule || formDelta === 0 || (formType === 'attendance' && formAttStatuses.size === 0)}
                  className="flex-1 py-2.5 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 transition-colors text-sm disabled:opacity-50"
                >
                  {savingRule ? '추가 중...' : '추가'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 보안 질문 모달 */}
      {showSqModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldQuestion size={18} className="text-blue-500" />
                <h2 className="font-bold text-slate-800">비밀번호 찾기 질문</h2>
              </div>
              <button onClick={() => setShowSqModal(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            {sqSaved ? (
              <div className="p-8 flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center"><Check size={28} className="text-emerald-600" /></div>
                <p className="font-bold text-slate-800">저장됐어요!</p>
              </div>
            ) : (
              <form onSubmit={handleSaveSQ} className="p-5 space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    본인만 알 수 있는 <span className="font-semibold">질문과 답변</span>을 만들어주세요.<br />
                    가장 잘 기억할 수 있는 것으로 설정하는 게 좋아요.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">질문</label>
                  <input
                    type="text"
                    value={sqQuestion}
                    onChange={e => setSqQuestion(e.target.value)}
                    placeholder="예: 내 첫 번째 반려동물 이름은?"
                    required
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">답변</label>
                  <input
                    type="text"
                    value={sqAnswer}
                    onChange={e => setSqAnswer(e.target.value)}
                    placeholder="가장 잘 기억할 수 있는 답변을 쓰세요"
                    required
                    autoComplete="off"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">대·소문자 구분 없이 입력해도 돼요</p>
                </div>
                {sqError && <p className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{sqError}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setShowSqModal(false)}
                    className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-xl text-sm">취소</button>
                  <button type="submit" disabled={sqSaving}
                    className="flex-1 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors text-sm disabled:opacity-50">
                    {sqSaving ? '저장 중...' : '저장'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── 내 정보 탭 ── */}
      {/* ── 재밌는 기능 탭 ── */}
      {tab === 'fun' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
            {/* 헤더 */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center">
                <Heart size={16} className="text-red-500 fill-red-500" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800">목숨 상세설정</h2>
                <p className="text-xs text-slate-400">학생에게 목숨을 부여하고 수업에서 활용해 보세요</p>
              </div>
            </div>

            {/* 활성화 토글 */}
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-semibold text-slate-700">목숨 시스템 활성화</p>
                <p className="text-xs text-slate-400 mt-0.5">켜면 학생 앱 홈에 목숨이 표시돼요</p>
              </div>
              <button
                onClick={() => isAdmin && setLivesEnabled(v => !v)}
                disabled={!isAdmin}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  livesEnabled ? 'bg-red-500' : 'bg-slate-200'
                } disabled:opacity-60`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  livesEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {/* 기본 목숨 수 */}
            {livesEnabled && (
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">기본 목숨 수</p>
                  <p className="text-xs text-slate-400 mt-0.5">신규 학생 또는 초기화 시 기준이 되는 목숨 수예요</p>
                </div>
                <div className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-2.5 self-start">
                  <button
                    onClick={() => isAdmin && setLivesDefault(v => Math.max(1, v - 1))}
                    disabled={!isAdmin || livesDefault <= 1}
                    className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-red-50 hover:border-red-300 hover:text-red-500 transition-colors disabled:opacity-30 text-lg font-bold leading-none flex-shrink-0"
                  >−</button>
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {Array.from({ length: Math.min(livesDefault, 10) }).map((_, i) => (
                      <Heart key={i} size={16} className="text-red-500 fill-red-500" />
                    ))}
                    {livesDefault > 10 && (
                      <span className="text-sm font-bold text-red-500 ml-1">+{livesDefault - 10}</span>
                    )}
                  </div>
                  <span className="text-base font-bold text-slate-800 flex-shrink-0">{livesDefault}개</span>
                  <button
                    onClick={() => isAdmin && setLivesDefault(v => v + 1)}
                    disabled={!isAdmin}
                    className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-green-50 hover:border-green-300 hover:text-green-600 transition-colors disabled:opacity-30 text-lg font-bold leading-none flex-shrink-0"
                  >+</button>
                </div>
              </div>
            )}

            {/* 저장 버튼 */}
            {isAdmin && livesLoaded && (
              <button
                onClick={saveLivesSettings}
                disabled={savingLives}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  livesSaved
                    ? 'bg-emerald-500 text-white'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {livesSaved
                  ? <><Check size={14} /> 저장됨</>
                  : savingLives
                  ? <><Loader2 size={14} className="animate-spin" /> 저장 중...</>
                  : '저장'}
              </button>
            )}

            {/* ── 자동화 섹션 ── */}
            {livesEnabled && rulesLoaded && (
              <>
                <div className="border-t border-slate-100" />

                {/* 자동화 서브 헤더 */}
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-violet-500" />
                  <p className="text-sm font-bold text-slate-700">목숨 자동화</p>
                  <p className="text-xs text-slate-400">규칙에 따라 자동으로 조정해요</p>
                </div>

                {/* 자동화 on/off */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">자동화 활성화</p>
                    <p className="text-xs text-slate-400 mt-0.5">켜면 출결·과제·클리닉·시험 시 자동으로 목숨이 바뀌어요</p>
                  </div>
                  <button
                    onClick={() => isAdmin && setLivesAutoEnabled(v => !v)}
                    disabled={!isAdmin}
                    className="disabled:opacity-60"
                  >
                    {livesAutoEnabled
                      ? <ToggleRight size={36} className="text-violet-600" />
                      : <ToggleLeft size={36} className="text-slate-300" />}
                  </button>
                </div>

                {/* 집계 시작일 */}
                {livesAutoEnabled && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-slate-700">집계 시작일</p>
                    <p className="text-xs text-slate-400">이 날짜부터의 데이터를 기준으로 목숨을 계산해요. 변경하면 전체 재계산이 실행돼요.</p>
                    <input
                      type="date"
                      value={livesAutoFrom}
                      onChange={e => isAdmin && setLivesAutoFrom(e.target.value)}
                      disabled={!isAdmin}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                )}

                {/* 자동화 저장 + 재계산 버튼 */}
                {isAdmin && livesAutoEnabled && (
                  <div className="flex gap-2">
                    <button
                      onClick={saveAutoSettings}
                      disabled={savingAuto || manualRecalculating}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                        autoSaved
                          ? 'bg-emerald-500 text-white'
                          : 'bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50'
                      }`}
                    >
                      {autoSaved
                        ? <><Check size={14} /> 저장됨</>
                        : savingAuto
                        ? <><Loader2 size={14} className="animate-spin" /> 저장 중...</>
                        : '자동화 저장'}
                    </button>
                    <button
                      onClick={manualRecalculate}
                      disabled={manualRecalculating || savingAuto}
                      className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5 border ${
                        manualRecalcDone
                          ? 'bg-emerald-500 text-white border-emerald-500'
                          : 'border-violet-300 text-violet-600 hover:bg-violet-50 disabled:opacity-50'
                      }`}
                    >
                      {manualRecalcDone
                        ? <><Check size={14} /> 완료</>
                        : manualRecalculating
                        ? <><Loader2 size={14} className="animate-spin" /> 계산 중...</>
                        : <><RefreshCw size={14} /> 재계산</>}
                    </button>
                  </div>
                )}

                {/* 규칙 목록 */}
                {livesAutoEnabled && (
                  <div className="pt-2 border-t border-slate-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-700">자동화 규칙</p>
                      {isAdmin && (
                        <button
                          onClick={() => { resetRuleForm(); setShowRuleForm(true) }}
                          className="flex items-center gap-1 text-xs font-semibold text-violet-600 bg-violet-50 px-3 py-1.5 rounded-lg hover:bg-violet-100 transition-colors"
                        >
                          <Plus size={13} /> 규칙 추가
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">같은 이벤트(수업·과제·시험)엔 위에서부터 순서대로 확인해 첫 번째 맞는 규칙 하나만 적용돼요. 시험은 미제출 규칙이 점수 규칙보다 항상 먼저예요.</p>

                    {livesRules.length === 0 ? (
                      <div className="bg-slate-50 rounded-xl p-4 text-center">
                        <p className="text-xs text-slate-400">등록된 규칙이 없어요. 규칙을 추가해보세요!</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {livesRules.map(rule => (
                          <div
                            key={rule.id}
                            draggable={isAdmin}
                            onDragStart={() => setDraggingId(rule.id)}
                            onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
                            onDragOver={e => { e.preventDefault(); setDragOverId(rule.id) }}
                            onDrop={() => handleDrop(rule.id)}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all select-none ${
                              draggingId === rule.id
                                ? 'opacity-40 scale-95'
                                : dragOverId === rule.id && draggingId !== rule.id
                                ? 'border-violet-400 bg-violet-50 shadow-sm'
                                : rule.enabled
                                ? 'bg-white border-violet-100'
                                : 'bg-slate-50 border-slate-100 opacity-60'
                            }`}
                          >
                            {isAdmin && (
                              <GripVertical size={16} className="text-slate-300 flex-shrink-0 cursor-grab active:cursor-grabbing" />
                            )}
                            <span className="text-base flex-shrink-0">{COND_ICON[rule.condition_type]}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-700 truncate">{ruleDescription(rule)}</p>
                              <p className="text-xs text-slate-400">{COND_LABEL[rule.condition_type]}</p>
                            </div>
                            <span className={`text-sm font-bold flex-shrink-0 ${
                              rule.delta > 0 ? 'text-emerald-600' : 'text-red-500'
                            }`}>
                              {rule.delta > 0 ? `+${rule.delta}` : rule.delta}
                            </span>
                            {isAdmin && (
                              <>
                                <button
                                  onClick={() => toggleRule(rule.id, !rule.enabled)}
                                  className="text-slate-400 hover:text-violet-600 transition-colors flex-shrink-0"
                                >
                                  {rule.enabled
                                    ? <ToggleRight size={20} className="text-violet-500" />
                                    : <ToggleLeft size={20} />}
                                </button>
                                <button
                                  onClick={() => deleteRule(rule.id)}
                                  className="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 앞으로 추가될 기능 안내 */}
          <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-4 text-center">
            <Sparkles size={20} className="mx-auto mb-2 text-slate-300" />
            <p className="text-xs text-slate-400">앞으로 더 재밌는 기능들이 추가될 예정이에요!</p>
          </div>
        </div>
      )}

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

          {/* 비밀번호 찾기 질문 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-800">비밀번호 찾기 질문</h2>
              {sqLoaded && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${currentSQ ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                  {currentSQ ? '설정됨' : '미설정'}
                </span>
              )}
            </div>
            {currentSQ && (
              <div className="bg-slate-50 rounded-xl px-4 py-3">
                <p className="text-xs text-slate-500 mb-1">현재 질문</p>
                <p className="text-sm text-slate-700 font-medium">{currentSQ}</p>
              </div>
            )}
            {!currentSQ && (
              <p className="text-sm text-slate-500">
                질문을 설정해두면 비밀번호를 잊었을 때 스스로 재설정할 수 있어요.
              </p>
            )}
            <button
              onClick={() => { setSqQuestion(currentSQ ?? ''); setSqAnswer(''); setSqError(''); setSqSaved(false); setShowSqModal(true) }}
              className="w-full py-2.5 bg-blue-50 text-blue-600 text-sm font-semibold rounded-xl hover:bg-blue-100 transition-colors flex items-center justify-center gap-1.5"
            >
              <ShieldQuestion size={15} />
              {currentSQ ? '질문 변경하기' : '질문 설정하기'}
            </button>
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
