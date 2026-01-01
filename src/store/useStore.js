import { create } from 'zustand'

export const useStore = create((set) => ({
    section: 'home',
    setSection: (section) => set({ section }),
}))
