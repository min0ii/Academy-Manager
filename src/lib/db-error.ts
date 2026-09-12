// Supabase(Postgres) 오류를 사용자가 읽을 수 있는 문장으로 바꿔준다.
// 원문은 영문 개발자용 메시지라 화면에 그대로 띄우지 않고 콘솔에만 남긴다.

type DbErrorLike = { code?: string | null; message?: string | null } | null | undefined

export function dbErrorMessage(error: DbErrorLike, action: '저장' | '삭제' = '저장'): string {
  console.error(`[${action} 실패]`, error)

  const code = error?.code ?? ''
  const raw  = (error?.message ?? '').toLowerCase()

  // 같은 기록이 이미 있음 (unique_violation) — 화면이 최신이 아닐 때 발생
  if (code === '23505' || raw.includes('duplicate key'))
    return '이미 저장된 기록이에요.\n화면을 새로고침한 뒤 다시 시도해 주세요.'

  // 연결된 기록이 남아 있음 (foreign_key_violation)
  if (code === '23503' || raw.includes('foreign key'))
    return `연결된 다른 기록이 있어서 ${action}할 수 없어요.\n관련 기록을 먼저 정리해 주세요.`

  // 필수 값이 비어 있음 (not_null_violation)
  if (code === '23502')
    return '필요한 항목이 비어 있어요.\n내용을 확인한 뒤 다시 시도해 주세요.'

  // 권한 문제
  if (code === '42501' || raw.includes('permission') || raw.includes('policy'))
    return `${action} 권한이 없어요.\n로그아웃 후 다시 로그인해 주세요.`

  // 네트워크 문제
  if (raw.includes('failed to fetch') || raw.includes('networkerror') || raw.includes('network request failed'))
    return '인터넷 연결이 불안정해요.\n연결을 확인한 뒤 다시 시도해 주세요.'

  return `${action}하지 못했어요.\n잠시 후 다시 시도해 주세요.`
}
