'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

type DialogState = {
  open: boolean
  type: 'alert' | 'confirm' | 'prompt'
  message: string
  destructive?: boolean
  confirmText?: string
  inputDefault?: string
  inputPlaceholder?: string
}

export function useDialog() {
  const [state, setState] = useState<DialogState>({ open: false, type: 'alert', message: '' })
  const resolveRef = useRef<((v: any) => void) | null>(null)
  const [promptInput, setPromptInput] = useState('')
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const showAlert = useCallback((message: string): Promise<boolean> => {
    return new Promise(resolve => {
      resolveRef.current = resolve
      setState({ open: true, type: 'alert', message })
    })
  }, [])

  const showConfirm = useCallback((message: string, opts?: { destructive?: boolean; confirmText?: string }): Promise<boolean> => {
    return new Promise(resolve => {
      resolveRef.current = resolve
      setState({ open: true, type: 'confirm', message, destructive: opts?.destructive, confirmText: opts?.confirmText })
    })
  }, [])

  const showPrompt = useCallback((message: string, opts?: { defaultValue?: string; placeholder?: string }): Promise<string | null> => {
    return new Promise(resolve => {
      resolveRef.current = resolve
      setPromptInput(opts?.defaultValue ?? '')
      setState({ open: true, type: 'prompt', message, inputDefault: opts?.defaultValue, inputPlaceholder: opts?.placeholder })
    })
  }, [])

  function close(value: boolean) {
    if (state.type === 'prompt') {
      resolveRef.current?.(value ? promptInput : null)
    } else {
      resolveRef.current?.(value)
    }
    resolveRef.current = null
    setState(s => ({ ...s, open: false }))
  }

  const dialogEl = (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) close(false) }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 space-y-5">
        <p className="text-slate-800 text-[15px] leading-relaxed whitespace-pre-line">{state.message}</p>
        {state.type === 'prompt' && (
          <input
            type="number"
            value={promptInput}
            onChange={e => setPromptInput(e.target.value)}
            placeholder={state.inputPlaceholder ?? ''}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') close(true); if (e.key === 'Escape') close(false) }}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
          />
        )}
        <div className="flex gap-2.5 justify-end">
          <button
            onClick={() => close(false)}
            className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => close(true)}
            className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-colors ${
              state.destructive
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {state.confirmText ?? '확인'}
          </button>
        </div>
      </div>
    </div>
  )

  const dialog = mounted && state.open
    ? createPortal(dialogEl, document.body)
    : null

  return { showAlert, showConfirm, showPrompt, dialog }
}
