import { create } from 'zustand'

export const useStore = create((set) => ({
    section: 'home',
    setSection: (section) => set({ section }),
    showVoid: false,
    setShowVoid: (showVoid) => set({ showVoid }),
    showVoidLogin: false,
    setShowVoidLogin: (showVoidLogin) => set({ showVoidLogin }),
    cameraAnimation: null, // 'dive' | 'eject' | null - for VOID experience
    setCameraAnimation: (cameraAnimation) => set({ cameraAnimation }),
    isDiving: false,
    setIsDiving: (isDiving) => set({ isDiving }),
    isExiting: false,
    setIsExiting: (isExiting) => set({ isExiting }),
    insideBlackHole: false, // true when camera is inside the VOID
    setInsideBlackHole: (insideBlackHole) => set({ insideBlackHole }),
    isMenuOpen: false,
    setIsMenuOpen: (isMenuOpen) => set({ isMenuOpen }),
    postLoginView: null, // null | 'chats' | 'dashboard'
    setPostLoginView: (postLoginView) => set({ postLoginView }),
    selectedChatId: null,
    setSelectedChatId: (selectedChatId) => set({ selectedChatId }),
}))
