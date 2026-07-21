'use client'

import { useState, useRef } from 'react'

// 포인터 이벤트 기반 드래그 정렬 훅 (모바일/데스크탑 공통)
// data-didx 속성이 있는 요소를 감지해 순서를 변경합니다.
export function useDragSort<T>(
  setItems: React.Dispatch<React.SetStateAction<T[]>>,
  onDirty?: () => void,
  scrollRef?: React.RefObject<HTMLElement | null>,
) {
  const fromRef = useRef<number | null>(null)
  const toRef   = useRef<number | null>(null)
  const [dragIdx,     setDragIdx]     = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  function startDrag(e: React.PointerEvent, idx: number) {
    e.preventDefault()
    fromRef.current = idx
    setDragIdx(idx)

    function onMove(ev: PointerEvent) {
      const EDGE = 80, SPEED = 10
      const scrollEl = scrollRef?.current
      if (scrollEl) {
        const r = scrollEl.getBoundingClientRect()
        if (ev.clientY - r.top < EDGE)    scrollEl.scrollBy(0, -SPEED)
        else if (r.bottom - ev.clientY < EDGE) scrollEl.scrollBy(0,  SPEED)
      } else {
        if (ev.clientY < EDGE)                        window.scrollBy(0, -SPEED)
        else if (window.innerHeight - ev.clientY < EDGE) window.scrollBy(0,  SPEED)
      }

      const hit = document.elementsFromPoint(ev.clientX, ev.clientY)
        .find(el => el.hasAttribute('data-didx'))
      if (hit) {
        const i = Number(hit.getAttribute('data-didx'))
        toRef.current = i
        setDragOverIdx(i)
      }
    }

    function onUp() {
      const from = fromRef.current, to = toRef.current
      if (from !== null && to !== null && from !== to) {
        setItems(prev => {
          const next = [...prev]
          const [item] = next.splice(from, 1)
          next.splice(to, 0, item)
          return next
        })
        onDirty?.()
      }
      fromRef.current = null
      toRef.current   = null
      setDragIdx(null)
      setDragOverIdx(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup',   onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
  }

  return { dragIdx, dragOverIdx, startDrag }
}
