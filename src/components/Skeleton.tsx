// 공통 로딩 스켈레톤 — 로딩 중임을 일관되게 표시하고 레이아웃 출렁임을 방지
// 사용처: 학생·학부모 탭 콘텐츠, 선생님 학생 리포트

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200/70 rounded-lg ${className}`} />
}

// 카드형 목록 로딩 (성적·과제·클리닉·출결 등 탭 콘텐츠용)
export function ListSkeleton({ cards = 2, rows = 3 }: { cards?: number; rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: cards }).map((_, c) => (
        <div key={c} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <Skeleton className="h-4 w-1/3" />
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-12 flex-shrink-0" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// 이미 테두리가 있는 카드 안에 넣는 행 목록 스켈레톤 (테두리 없음)
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="px-5 py-4 space-y-3" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-12 flex-shrink-0" />
        </div>
      ))}
    </div>
  )
}

// 첫 진입(전체 화면) 로딩 — 스피너 + 텍스트
export function PageLoading({ label = '불러오는 중...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16" aria-busy="true">
      <div className="w-7 h-7 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
      <p className="text-slate-400 text-sm">{label}</p>
    </div>
  )
}
