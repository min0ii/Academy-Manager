'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, LayoutGrid, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAcademy } from '@/lib/academy-context'
import { todayKST } from '@/lib/date'
import { PageLoading } from '@/components/Skeleton'
import ExamGroupWidget from './ExamGroupWidget'

type Stats = {
  studentCount: number
  classCount: number
}

type ActiveClass = {
  id: string
  name: string
  start_time: string
  end_time: string
}


export default function DashboardPage() {
  const ctx = useAcademy()
  const [stats, setStats] = useState<Stats>({ studentCount: 0, classCount: 0 })
  const [activeClasses, setActiveClasses] = useState<ActiveClass[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ctx) return
    ;(async () => {
      const now = new Date()
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`
      const dayOfWeek = now.getDay()

      const [{ count: studentCount }, { count: classCount }, { data: classData }] = await Promise.all([
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('academy_id', ctx.academyId).eq('status', 'active'),
        supabase.from('classes').select('*', { count: 'exact', head: true }).eq('academy_id', ctx.academyId),
        supabase.from('classes').select('id, name').eq('academy_id', ctx.academyId),
      ])
      setStats({ studentCount: studentCount ?? 0, classCount: classCount ?? 0 })

      const classIds = (classData ?? []).map(c => c.id)
      const classMap: Record<string, string> = {}
      ;(classData ?? []).forEach(c => { classMap[c.id] = c.name })

      if (classIds.length > 0) {
        const todayStr = todayKST()

        const [{ data: scheduleData }, { data: sessionData }] = await Promise.all([
          supabase
            .from('class_schedules')
            .select('class_id, start_time, end_time')
            .in('class_id', classIds)
            .eq('day_of_week', dayOfWeek)
            .lte('start_time', currentTime)
            .gte('end_time', currentTime),
          supabase
            .from('sessions')
            .select('class_id, start_time, end_time')
            .in('class_id', classIds)
            .eq('date', todayStr)
            .lte('start_time', currentTime)
            .gte('end_time', currentTime),
        ])

        const seen = new Set<string>()
        const active: ActiveClass[] = []
        for (const s of [...(scheduleData ?? []), ...(sessionData ?? [])]) {
          if (!seen.has(s.class_id)) {
            seen.add(s.class_id)
            active.push({ id: s.class_id, name: classMap[s.class_id], start_time: s.start_time, end_time: s.end_time })
          }
        }
        setActiveClasses(active)
      }

      setLoading(false)
    })()
  }, [ctx])

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })

  if (loading) return <PageLoading />

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* 인사 헤더 */}
      <div>
        <p className="text-sm text-slate-500 mb-1">{today}</p>
        <h1 className="text-2xl font-bold text-slate-800">
          안녕하세요, {ctx?.teacherName} {ctx?.myTitle}님 👋
        </h1>
        <p className="text-slate-500 mt-1">{ctx?.academyName}의 오늘도 화이팅이에요!</p>
      </div>

      {/* 진행 중인 수업 배너 */}
      {activeClasses.length > 0 && (
        <div className="space-y-2">
          {activeClasses.map(cls => (
            <Link
              key={cls.id}
              href={`/dashboard/classes/${cls.id}`}
              className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl p-4 hover:bg-green-100 transition-colors group"
            >
              <div className="relative flex-shrink-0 w-3 h-3">
                <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-500" />
                <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-400 animate-ping" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-green-600 mb-0.5">지금 수업 진행 중</p>
                <p className="font-bold text-green-900 truncate">{cls.name}</p>
                <p className="text-xs text-green-600 mt-0.5">
                  {cls.start_time.slice(0, 5)} ~ {cls.end_time.slice(0, 5)}
                </p>
              </div>
              <ChevronRight size={18} className="text-green-400 group-hover:text-green-600 transition-colors flex-shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-50 rounded-xl">
              <Users size={18} className="text-blue-600" />
            </div>
            <span className="text-sm font-medium text-slate-600">전체 학생</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">{stats.studentCount}<span className="text-base font-normal text-slate-500 ml-1">명</span></p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-violet-50 rounded-xl">
              <LayoutGrid size={18} className="text-violet-600" />
            </div>
            <span className="text-sm font-medium text-slate-600">운영 반</span>
          </div>
          <p className="text-3xl font-bold text-slate-800">{stats.classCount}<span className="text-base font-normal text-slate-500 ml-1">개</span></p>
        </div>
      </div>

      {/* 시험 모아보기 위젯 */}
      <ExamGroupWidget />

    </div>
  )
}
