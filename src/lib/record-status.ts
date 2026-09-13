import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────
// 과제·클리닉 수행 기록 저장 공용 로직
//
// 같은 저장이 반 상세 화면(dashboard/classes/[id])과
// 기록 화면(dashboard/homework)에서 각각 일어난다.
// 저장한 뒤 목숨 재계산을 빠뜨리면 기록만 바뀌고 목숨이 조용히 어긋나므로,
// "저장 + 목숨 트리거"를 반드시 한 덩어리로 묶어둔다.
// ─────────────────────────────────────────────────────────────

type StatusRec = { id: string | null; status: string | null } | undefined
type DbError = { code?: string | null; message?: string | null }

export type WriteResult =
  | { ok: true; cleared: boolean; newId: string | null }
  | { ok: false; error: DbError }

// 목숨 자동화 트리거 — 응답을 기다리지 않는다.
// 학원이나 반의 목숨이 꺼져 있으면 서버(recalculateStudent)가 알아서 아무것도 하지 않는다.
export function applyLivesRule(
  academyId: string,
  studentId: string,
  eventType: 'homework' | 'clinic' | 'attendance',
  eventDetail: Record<string, unknown>,
) {
  if (!academyId) return
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.access_token) return
    fetch('/api/lives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'apply-rules', academyId, studentId, eventType, eventDetail }),
    }).catch(() => {})
  })
}

// 과제 수행 기록 저장. 누른 상태가 지금 상태와 같으면 기록을 지운다(토글).
export async function writeHomeworkStatus(
  rec: StatusRec,
  hwId: string,
  studentId: string,
  status: 'done' | 'partial' | 'none',
  ctx: { academyId: string; date: string },
): Promise<WriteResult> {
  const fire = (s: string | null) =>
    applyLivesRule(ctx.academyId, studentId, 'homework', { status: s, date: ctx.date })

  if (rec?.id) {
    if (rec.status === status) {
      const { error } = await supabase.from('homework_status').delete().eq('id', rec.id)
      if (error) return { ok: false, error }
      fire(null)
      return { ok: true, cleared: true, newId: null }
    }
    const { error } = await supabase.from('homework_status').update({ status }).eq('id', rec.id)
    if (error) return { ok: false, error }
    fire(status)
    return { ok: true, cleared: false, newId: rec.id }
  }

  const { data, error } = await supabase.from('homework_status')
    .insert({ homework_id: hwId, student_id: studentId, status }).select('id').single()

  // 화면이 최신이 아니어서 이미 있는 기록에 다시 넣는 경우가 있다(빠른 연타 등).
  // 사용자에게 오류를 띄우는 대신 기존 행을 찾아 갱신한다.
  if (error?.code === '23505') {
    const { data: exist } = await supabase.from('homework_status')
      .select('id').eq('homework_id', hwId).eq('student_id', studentId).maybeSingle()
    if (exist?.id) {
      const { error: e2 } = await supabase.from('homework_status').update({ status }).eq('id', exist.id)
      if (e2) return { ok: false, error: e2 }
      fire(status)
      return { ok: true, cleared: false, newId: exist.id }
    }
  }
  if (error) return { ok: false, error }
  fire(status)
  return { ok: true, cleared: false, newId: data?.id ?? null }
}

// 클리닉 수행 기록 저장. 누른 상태가 지금 상태와 같으면 기록을 지운다(토글).
export async function writeClinicStatus(
  rec: StatusRec,
  sessionId: string,
  studentId: string,
  status: 'done' | 'not_done',
  ctx: { academyId: string; date: string },
): Promise<WriteResult> {
  const fire = (s: string | null) =>
    applyLivesRule(ctx.academyId, studentId, 'clinic', { status: s, date: ctx.date })

  if (rec?.id) {
    if (rec.status === status) {
      const { error } = await supabase.from('clinic_attendance').delete().eq('id', rec.id)
      if (error) return { ok: false, error }
      fire(null)
      return { ok: true, cleared: true, newId: null }
    }
    const { error } = await supabase.from('clinic_attendance').update({ status }).eq('id', rec.id)
    if (error) return { ok: false, error }
    fire(status)
    return { ok: true, cleared: false, newId: rec.id }
  }

  const { data, error } = await supabase.from('clinic_attendance')
    .insert({ clinic_session_id: sessionId, student_id: studentId, status }).select('id').single()
  if (error) return { ok: false, error }
  fire(status)
  return { ok: true, cleared: false, newId: data?.id ?? null }
}

// 과제 코멘트 저장 — 상태 기록(행)이 있어야만 붙일 수 있다.
export async function writeHomeworkNote(statusId: string, note: string) {
  return supabase.from('homework_status').update({ note: note || null }).eq('id', statusId)
}
