/**
 * 학년 표시 유틸
 * - '1' → '1학년', '2' → '2학년', '3' → '3학년'
 * - 'N수' → 'N수' (접미사 없음)
 */
export function gradeLabel(grade: string | null | undefined): string {
  if (!grade) return ''
  if (grade === 'N수') return 'N수'
  return `${grade}학년`
}
