'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { dbErrorMessage } from '@/lib/db-error'
import { useDialog } from '@/components/AppDialog'
import ReportSheet, { SHEET_WIDTH, type ReportStudent } from './ReportSheet'
import { Download, Package, RefreshCw, FileImage, Check } from 'lucide-react'

type Cls = { id: string; name: string }
type Teacher = { id: string; name: string; title: string }
type ReportData = {
  className: string
  teachers: Teacher[]
  categories: string[]
  students: ReportStudent[]
}

// 파일명에 못 쓰는 글자 정리
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim()
const iso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

export default function ReportTab({ academyId, classes }: { academyId: string; classes: Cls[] }) {
  const { showAlert, dialog } = useDialog()

  const today = useMemo(() => new Date(), [])
  const weekAgo = useMemo(() => new Date(Date.now() - 6 * 864e5), [])

  const [classId, setClassId] = useState('')
  const [from, setFrom] = useState(iso(weekAgo))
  const [to, setTo]     = useState(iso(today))
  const [category, setCategory] = useState('')
  const [teacherName, setTeacherName] = useState('')

  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const [comment, setComment] = useState('')
  const [savingComment, setSavingComment] = useState(false)
  const [commentSaved, setCommentSaved] = useState(false)

  const [busy, setBusy] = useState<string | null>(null)   // 진행 상황 문구
  const captureRef = useRef<HTMLDivElement>(null)
  const [captureId, setCaptureId] = useState<string | null>(null)

  useEffect(() => { if (!classId && classes.length) setClassId(classes[0].id) }, [classes, classId])

  // ── 불러오기
  const load = useCallback(async (opts?: { category?: string }) => {
    if (!classId) return
    setLoading(true)
    setData(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { void showAlert('로그인이 만료됐어요.\n다시 로그인해 주세요.'); return }
      const cat = opts?.category ?? category
      const qs = new URLSearchParams({ classId, from, to, category: cat })
      const res = await fetch(`/api/report?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        void showAlert(err.error ?? '불러오지 못했어요.\n잠시 후 다시 시도해 주세요.')
        return
      }
      const d: ReportData = await res.json()
      setData(d)
      // 카테고리를 아직 안 골랐으면 '예제 점수'가 있으면 그걸로, 없으면 첫 번째로
      if (!cat && d.categories.length) {
        const pick = d.categories.includes('예제 점수') ? '예제 점수' : d.categories[0]
        setCategory(pick)
        void load({ category: pick })
        return
      }
      // 담당 선생님 기본값 — 박정우가 있으면 박정우
      if (!teacherName && d.teachers.length) {
        setTeacherName(d.teachers.find(t => t.name === '박정우')?.name ?? d.teachers[0].name)
      }
      setSelected(prev => (prev && d.students.some(s => s.id === prev)) ? prev : (d.students[0]?.id ?? null))
    } finally {
      setLoading(false)
    }
  }, [classId, from, to, category, teacherName, showAlert])

  const current = data?.students.find(s => s.id === selected) ?? null
  useEffect(() => { setComment(current?.comment ?? ''); setCommentSaved(false) }, [current?.id, current?.comment])

  // ── 코멘트 저장
  async function saveComment() {
    if (!current) return
    setSavingComment(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: exist } = await supabase.from('comments')
        .select('id').eq('student_id', current.id).gte('date', from).lte('date', to)
        .order('date', { ascending: false }).limit(1).maybeSingle()

      const { error } = exist?.id
        ? await supabase.from('comments').update({ content: comment }).eq('id', exist.id)
        : await supabase.from('comments').insert({
            student_id: current.id, teacher_id: user?.id ?? null, date: to, content: comment,
          })
      if (error) { void showAlert(dbErrorMessage(error, '저장')); return }

      setData(d => d ? { ...d, students: d.students.map(s => s.id === current.id ? { ...s, comment } : s) } : d)
      setCommentSaved(true)
    } finally { setSavingComment(false) }
  }

  // ── 한 학생을 숨겨둔 영역에 그려서 PNG 로 뽑는다
  async function capture(studentId: string): Promise<Blob> {
    const { toBlob } = await import('html-to-image')
    flushSync(() => setCaptureId(studentId))
    // 레이아웃이 자리 잡은 뒤에 찍는다
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
    const node = captureRef.current
    if (!node) throw new Error('리포트를 그리지 못했어요.')
    const blob = await toBlob(node, {
      pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true,
      width: SHEET_WIDTH, height: node.scrollHeight,
      // skipFonts: 웹폰트를 쓰지 않는데도 html-to-image 가 모든 스타일시트를 뒤지며
      // 원격 CSS 를 가져오려다 멈춘다. 이 리포트는 시스템 폰트만 쓰므로 건너뛴다.
      skipFonts: true,
    })
    if (!blob) throw new Error('이미지를 만들지 못했어요.')
    return blob
  }

  function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  const fileBase = (s: ReportStudent) => `${safe(data?.className ?? '')}_${safe(s.name)}_${to}`

  async function downloadOne() {
    if (!current) return
    setBusy('이미지 만드는 중...')
    try {
      saveBlob(await capture(current.id), `${fileBase(current)}.png`)
    } catch (e: any) {
      void showAlert(e?.message ?? '이미지를 만들지 못했어요.')
    } finally { setBusy(null); setCaptureId(null) }
  }

  async function downloadAll() {
    if (!data || data.students.length === 0) return
    setBusy('준비 중...')
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      for (let i = 0; i < data.students.length; i++) {
        const st = data.students[i]
        setBusy(`${i + 1} / ${data.students.length} — ${st.name}`)
        zip.file(`${fileBase(st)}.png`, await capture(st.id))
      }
      setBusy('압축하는 중...')
      const blob = await zip.generateAsync({ type: 'blob' })
      saveBlob(blob, `${safe(data.className)}_리포트_${to}.zip`)
    } catch (e: any) {
      void showAlert(e?.message ?? '일괄 저장에 실패했어요.')
    } finally { setBusy(null); setCaptureId(null) }
  }

  const captureStudent = data?.students.find(s => s.id === captureId) ?? null

  return (
    <div className="space-y-4">
      {dialog}

      {/* ── 조건 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">반</span>
            <select value={classId} onChange={e => { setClassId(e.target.value); setData(null) }}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">담당 선생님</span>
            <select value={teacherName} onChange={e => setTeacherName(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
              {(data?.teachers ?? []).map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              {!data && <option value="">불러오는 중</option>}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">시작일</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">종료일</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-semibold text-slate-500">점수에 쓸 시험 종류</span>
            <select value={category} onChange={e => { setCategory(e.target.value); void load({ category: e.target.value }) }}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
              {(data?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
              {!data?.categories?.length && <option value="">{data ? '이 반에 시험이 없어요' : '불러오는 중'}</option>}
            </select>
          </label>
        </div>
        <button onClick={() => void load()} disabled={loading || !classId}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          {loading ? '불러오는 중...' : '리포트 불러오기'}
        </button>
      </div>

      {data && data.students.length === 0 && (
        <p className="text-center py-10 text-slate-400 text-sm">이 반에 재원 중인 학생이 없어요.</p>
      )}

      {data && data.students.length > 0 && (
        <>
          {/* ── 학생 고르기 + 일괄 저장 ── */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">학생 {data.students.length}명</p>
              <button onClick={() => void downloadAll()} disabled={!!busy}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 text-white text-xs font-semibold rounded-xl hover:bg-slate-900 transition-colors disabled:opacity-50">
                <Package size={14} /> 전체 일괄 저장 (ZIP)
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.students.map(s => (
                <button key={s.id} onClick={() => setSelected(s.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    selected === s.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {s.name}
                  {s.comment && <span className={selected === s.id ? 'text-blue-200' : 'text-emerald-500'}> ●</span>}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">● 표시는 코멘트가 저장된 학생이에요.</p>
            {busy && <p className="text-xs font-semibold text-blue-600">{busy}</p>}
          </div>

          {/* ── 코멘트 ── */}
          {current && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">{current.name} 코멘트</p>
                <button onClick={() => void saveComment()} disabled={savingComment}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    commentSaved ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-600 text-white hover:bg-blue-700'
                  } disabled:opacity-50`}>
                  {commentSaved ? <><Check size={13} /> 저장됨</> : savingComment ? '저장 중...' : '코멘트 저장'}
                </button>
              </div>
              <textarea value={comment} onChange={e => { setComment(e.target.value); setCommentSaved(false) }}
                rows={3} placeholder="학부모님께 전할 말씀을 적어 주세요."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
          )}

          {/* ── 미리보기 ── */}
          {current && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <FileImage size={15} className="text-slate-400" /> 미리보기
                </p>
                <button onClick={() => void downloadOne()} disabled={!!busy}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50">
                  <Download size={14} /> 이 학생 저장 (PNG)
                </button>
              </div>
              {/* 종이 폭이 고정이라 화면에서는 줄여서 보여준다 */}
              <div className="overflow-x-auto">
                <div className="origin-top-left scale-[0.62] sm:scale-75 md:scale-90" style={{ width: SHEET_WIDTH }}>
                  <div className="border border-slate-200 shadow-sm">
                    <ReportSheet student={current} className={data.className} teacherName={teacherName}
                      category={category} from={from} to={to} />
                  </div>
                </div>
                {/* scale 로 줄여도 자리는 원래 크기만큼 차지해서, 아래 여백을 줄여 준다 */}
                <div className="h-0 overflow-hidden" />
              </div>
            </div>
          )}
        </>
      )}

      {/* ── 캡처 전용 (화면 밖) ── */}
      <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none' }} aria-hidden>
        <div ref={captureRef} style={{ width: SHEET_WIDTH }}>
          {captureStudent && data && (
            <ReportSheet student={captureStudent} className={data.className} teacherName={teacherName}
              category={category} from={from} to={to} />
          )}
        </div>
      </div>
    </div>
  )
}
