import { create } from 'zustand'

export const useStore = create((set) => ({
    section: 'home',
    setSection: (section) => set({ section }),
    showGame: false,
    setShowGame: (showGame) => set({ showGame }),
    showMenu: false,
    setShowMenu: (showMenu) => set({ showMenu }),
    cameraAnimation: null, // 'dive' | null
    setCameraAnimation: (cameraAnimation) => set({ cameraAnimation }),
    isDiving: false,
    setIsDiving: (isDiving) => set({ isDiving }),
}))
