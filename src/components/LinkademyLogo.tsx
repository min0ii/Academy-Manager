export function LinkademyLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 300 54"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Linkademy"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Lin */}
      <text
        y="45"
        fontFamily="Pretendard, -apple-system, BlinkMacSystemFont, sans-serif"
        fontWeight="900"
        fontSize="46"
        fill="#7c3aed"
      >Lin</text>

      {/* k — purple */}
      <text
        x="83"
        y="45"
        fontFamily="Pretendard, -apple-system, BlinkMacSystemFont, sans-serif"
        fontWeight="900"
        fontSize="46"
        fill="#7c3aed"
      >k</text>

      {/* a — dark, 12px 당겨서 k에 붙임 */}
      <text
        x="107"
        y="45"
        fontFamily="Pretendard, -apple-system, BlinkMacSystemFont, sans-serif"
        fontWeight="900"
        fontSize="46"
        fill="#1e293b"
      >a</text>

      {/* k 하단 팔 끝 → a 볼 왼쪽 상단 연결 브릿지 */}
      {/* k lower arm tip ≈ (109, 41), a bowl left ≈ (107, 28) */}
      <path
        d="M 111,40 C 110,35 109,31 108,26"
        stroke="#7c3aed"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />

      {/* demy */}
      <text
        x="139"
        y="45"
        fontFamily="Pretendard, -apple-system, BlinkMacSystemFont, sans-serif"
        fontWeight="900"
        fontSize="46"
        fill="#1e293b"
      >demy</text>
    </svg>
  )
}
