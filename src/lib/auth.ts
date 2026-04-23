import { supabase } from './supabase'

// 전화번호를 내부 이메일 형식으로 변환 (Supabase Auth는 이메일 기반)
export function phoneToEmail(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return `${digits}@academy.local`
}

// 입력 중 자동으로 010-0000-0000 형식으로 포맷
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

export async function signIn(phone: string, password: string) {
  const email = phoneToEmail(phone)
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signUp(phone: string, password: string, name: string, role: 'teacher' | 'student' | 'parent') {
  const digits = phone.replace(/\D/g, '')
  const email = phoneToEmail(phone)

  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error || !data.user) return { error }

  // 프로필 직접 생성
  const { error: profileError } = await supabase.from('profiles').insert({
    id: data.user.id,
    phone: digits,
    name,
    role,
  })
  if (profileError) return { error: profileError }

  return { data, error: null }
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  return data
}
