import { create } from 'zustand'

const STORAGE_KEYS = {
    selectedChatId: 'insomnia_selectedChatId',
    postLoginView: 'insomnia_postLoginView',
}

function readStorage(key) {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function writeStorage(key, value) {
    try {
        if (value === null || value === undefined || value === '') {
            localStorage.removeItem(key)
        } else {
            localStorage.setItem(key, value)
        }
    } catch { }
}

function getInitialPostLoginView() {
    const stored = readStorage(STORAGE_KEYS.postLoginView)
    return stored === 'chats' || stored === 'dashboard' ? stored : null
}

function getInitialSelectedChatId() {
    return readStorage(STORAGE_KEYS.selectedChatId) || null
}

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
    postLoginView: getInitialPostLoginView(), // null | 'chats' | 'dashboard'
    setPostLoginView: (postLoginView) => {
        const normalized = postLoginView === 'chats' || postLoginView === 'dashboard' ? postLoginView : null
        writeStorage(STORAGE_KEYS.postLoginView, normalized)
        set({ postLoginView: normalized })
    },
    selectedChatId: getInitialSelectedChatId(),
    setSelectedChatId: (selectedChatId) => {
        writeStorage(STORAGE_KEYS.selectedChatId, selectedChatId || null)
        set({ selectedChatId })
    },
}))
