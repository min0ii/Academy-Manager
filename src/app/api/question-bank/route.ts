import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function verifyTeacher(db: ReturnType<typeof admin>, token: string) {
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) return null
  const { data: m } = await db.from('academy_teachers').select('academy_id').eq('teacher_id', user.id).single()
  return m?.academy_id ?? null
}

// GET /api/question-bank?folderId=xxx (null = 루트)
// → 해당 폴더의 하위 폴더 + 세트 목록
export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const academyId = await verifyTeacher(db, token)
  if (!academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const folderId = searchParams.get('folderId') // null = 루트
  const all = searchParams.get('all') === 'true'

  // 폴더 목록
  let folderQ = db.from('qb_folders').select('id, name, parent_id, created_at').eq('academy_id', academyId)
  if (!all) {
    if (folderId) folderQ = folderQ.eq('parent_id', folderId)
    else folderQ = folderQ.is('parent_id', null)
  }
  const { data: folders } = await folderQ.order('order_num', { ascending: true, nullsFirst: false })

  // all=true: 폴더 목록만 반환 (이동 모달용)
  if (all) return NextResponse.json({ folders: folders ?? [], sets: [] })

  // 세트 목록
  let setQ = db.from('qb_sets').select('id, title, folder_id, created_at, updated_at').eq('academy_id', academyId)
  if (folderId) setQ = setQ.eq('folder_id', folderId)
  else setQ = setQ.is('folder_id', null)
  const { data: sets } = await setQ.order('order_num', { ascending: true, nullsFirst: false })

  // 세트별 문제 수
  const setIds = (sets ?? []).map((s: any) => s.id)
  const { data: qRows } = setIds.length
    ? await db.from('qb_questions').select('set_id').in('set_id', setIds)
    : { data: [] }
  const countMap: Record<string, number> = {}
  for (const q of (qRows ?? [])) countMap[(q as any).set_id] = (countMap[(q as any).set_id] ?? 0) + 1

  const setsWithCount = (sets ?? []).map((s: any) => ({ ...s, questionCount: countMap[s.id] ?? 0 }))

  return NextResponse.json({ folders: folders ?? [], sets: setsWithCount })
}

// POST /api/question-bank
// action='create_folder' → { name, parentId? }
// action='create_set'    → { title, folderId? }
// action='rename_folder' → { id, name }
// action='rename_set'    → { id, title }
export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const academyId = await verifyTeacher(db, token)
  if (!academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { data: { user } } = await db.auth.getUser(token)
  const body = await req.json()
  const { action } = body

  if (action === 'create_folder') {
    const { name, parentId } = body
    if (!name?.trim()) return NextResponse.json({ error: '폴더 이름을 입력해주세요.' }, { status: 400 })
    const { data, error } = await db.from('qb_folders').insert({
      academy_id: academyId, name: name.trim(),
      parent_id: parentId ?? null, created_by: user?.id ?? null,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ folder: data })
  }

  if (action === 'create_set') {
    const { title, folderId } = body
    if (!title?.trim()) return NextResponse.json({ error: '세트 이름을 입력해주세요.' }, { status: 400 })
    const { data, error } = await db.from('qb_sets').insert({
      academy_id: academyId, title: title.trim(),
      folder_id: folderId ?? null, created_by: user?.id ?? null,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ set: data })
  }

  if (action === 'rename_folder') {
    const { id, name } = body
    await db.from('qb_folders').update({ name: name.trim() }).eq('id', id).eq('academy_id', academyId)
    return NextResponse.json({ success: true })
  }

  if (action === 'rename_set') {
    const { id, title } = body
    await db.from('qb_sets').update({ title: title.trim(), updated_at: new Date().toISOString() }).eq('id', id).eq('academy_id', academyId)
    return NextResponse.json({ success: true })
  }

  if (action === 'reorder_folders') {
    const { orders } = body  // [{ id, order_num }]
    await Promise.all(
      (orders as { id: string; order_num: number }[]).map(({ id, order_num }) =>
        db.from('qb_folders').update({ order_num }).eq('id', id).eq('academy_id', academyId)
      )
    )
    return NextResponse.json({ success: true })
  }

  if (action === 'move_set') {
    const { id, folderId } = body
    await db.from('qb_sets').update({ folder_id: folderId, order_num: null }).eq('id', id).eq('academy_id', academyId)
    return NextResponse.json({ success: true })
  }

  if (action === 'move_folder') {
    const { id, parentId } = body
    await db.from('qb_folders').update({ parent_id: parentId ?? null, order_num: null }).eq('id', id).eq('academy_id', academyId)
    return NextResponse.json({ success: true })
  }

  if (action === 'reorder_sets') {
    const { orders } = body  // [{ id, order_num }]
    await Promise.all(
      (orders as { id: string; order_num: number }[]).map(({ id, order_num }) =>
        db.from('qb_sets').update({ order_num }).eq('id', id).eq('academy_id', academyId)
      )
    )
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 })
}

// DELETE /api/question-bank?type=folder|set&id=xxx
export async function DELETE(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })

  const db = admin()
  const academyId = await verifyTeacher(db, token)
  if (!academyId) return NextResponse.json({ error: '권한이 없어요.' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const id   = searchParams.get('id')
  if (!type || !id) return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })

  if (type === 'folder') {
    // 하위 폴더 재귀 수집 (BFS)
    const allFolderIds: string[] = [id]
    const queue: string[] = [id]
    while (queue.length > 0) {
      const cur = queue.shift()!
      const { data: children } = await db.from('qb_folders').select('id').eq('parent_id', cur)
      for (const c of children ?? []) { allFolderIds.push(c.id); queue.push(c.id) }
    }

    // 하위 세트·문제·선택지·정답 삭제
    const { data: sets } = await db.from('qb_sets').select('id').in('folder_id', allFolderIds)
    const setIds = (sets ?? []).map((s: any) => s.id)
    if (setIds.length > 0) {
      const { data: qs } = await db.from('qb_questions').select('id').in('set_id', setIds)
      const qIds = (qs ?? []).map((q: any) => q.id)
      if (qIds.length > 0) {
        await db.from('qb_choices').delete().in('question_id', qIds)
        await db.from('qb_answers').delete().in('question_id', qIds)
        await db.from('qb_questions').delete().in('set_id', setIds)
      }
      await db.from('qb_sets').delete().in('folder_id', allFolderIds)
    }
    await db.from('qb_folders').delete().in('id', allFolderIds)

  } else if (type === 'set') {
    // 문제·선택지·정답 삭제 후 세트 삭제
    const { data: qs } = await db.from('qb_questions').select('id').eq('set_id', id)
    const qIds = (qs ?? []).map((q: any) => q.id)
    if (qIds.length > 0) {
      await db.from('qb_choices').delete().in('question_id', qIds)
      await db.from('qb_answers').delete().in('question_id', qIds)
      await db.from('qb_questions').delete().in('id', qIds)
    }
    await db.from('qb_sets').delete().eq('id', id).eq('academy_id', academyId)
  }

  return NextResponse.json({ success: true })
}
