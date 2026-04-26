'use client'
import { createContext, useContext } from 'react'

export type AcademyCtx = {
  userId: string
  academyId: string
  myRole: 'owner' | 'staff'
  myTitle: string
  teacherName: string
  academyName: string
  academyLogoUrl: string | null
}

export const AcademyContext = createContext<AcademyCtx | null>(null)

export function useAcademy() {
  return useContext(AcademyContext)
}
