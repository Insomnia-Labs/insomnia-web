import { create } from 'zustand'

export const useStore = create((set) => ({
    section: 'home',
    setSection: (section) => set({ section }),
    showGame: false,
    setShowGame: (showGame) => set({ showGame }),
    cameraAnimation: null, // 'dive' | 'eject' | null
    setCameraAnimation: (cameraAnimation) => set({ cameraAnimation }),
    isDiving: false,
    setIsDiving: (isDiving) => set({ isDiving }),
    isExiting: false,
    setIsExiting: (isExiting) => set({ isExiting }),
    insideBlackHole: false, // true when camera should stay frozen in black hole
    setInsideBlackHole: (insideBlackHole) => set({ insideBlackHole }),
    isMenuOpen: false,
    setIsMenuOpen: (isMenuOpen) => set({ isMenuOpen }),
}))
