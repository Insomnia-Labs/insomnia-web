import React, { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import { getDialogs, getMe } from '../../services/telegramClient'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Bookmark } from 'lucide-react'

export default function ChatList() {
    const { setPostLoginView, setSelectedChatId } = useStore()
    const [dialogs, setDialogs] = useState([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [error, setError] = useState('')
    const [myId, setMyId] = useState(null)

    useEffect(() => {
        // Keep current view persisted so accidental reload/tab discard returns here.
        setPostLoginView('chats')
    }, [setPostLoginView])

    useEffect(() => {
        let mounted = true
        async function fetchChats() {
            try {
                const me = await getMe()
                if (mounted) setMyId(me.id)

                const chats = await getDialogs(50) // Adjust limit as needed
                if (mounted) {
                    setDialogs(chats)
                    setLoading(false)
                }
            } catch (err) {
                console.error('Failed to fetch dialogs:', err)
                if (mounted) {
                    setError('Error loading chats: ' + err.message)
                    setLoading(false)
                }
            }
        }
        fetchChats()
        return () => { mounted = false }
    }, [])

    const handleChatClick = (chat) => {
        let idObj = chat.entity?.id || chat.id
        setSelectedChatId(idObj?.toString() || '')
        setPostLoginView('dashboard')
    }

    const formatTime = (timestamp) => {
        if (!timestamp) return ""
        const date = new Date(timestamp * 1000)
        const now = new Date()

        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
        if (now - date < 7 * 24 * 60 * 60 * 1000) {
            return date.toLocaleDateString([], { weekday: 'short' })
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }

    const filteredDialogs = dialogs.filter(chat => {
        if (!searchQuery) return true
        const title = chat.title?.toLowerCase() || ''
        return title.includes(searchQuery.toLowerCase())
    })

    filteredDialogs.sort((a, b) => {
        const aId = a.entity?.id?.toString()
        const bId = b.entity?.id?.toString()
        const meStr = myId?.toString()
        const aIsMe = aId === meStr
        const bIsMe = bId === meStr

        if (aIsMe && !bIsMe) return -1
        if (!aIsMe && bIsMe) return 1
        return 0
    })

    // Animation variants
    const containerVariants = {
        hidden: { opacity: 0, scale: 0.95 },
        visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }
    }

    const itemVariants = {
        hidden: { opacity: 0, y: 15, scale: 0.98 },
        visible: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 300, damping: 24 } },
        exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } }
    }

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-[#0f111a]/80 backdrop-blur-xl flex items-center justify-center z-[2001]"
        >
            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="w-[92%] max-w-[460px] h-[85vh] flex flex-col border border-white/10 rounded-[24px] bg-[#16161e]/90 overflow-hidden"
            >
                {/* Header Section */}
                <div className="pt-8 pb-4 px-6 shrink-0 bg-gradient-to-b from-[#16161e] to-transparent z-10">
                    <h1 className="text-[2rem] mb-6 text-center text-white/90 font-outfit font-semibold tracking-tight">
                        Chats
                    </h1>

                    <div className="relative group">
                        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-[14px] blur-md opacity-0 group-focus-within:opacity-100 transition-opacity duration-500"></div>
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="relative w-full bg-[#1e1e2b]/80 border border-white/5 py-3.5 pl-12 pr-6 rounded-[14px] text-white font-inter text-[0.95rem] outline-none transition-all duration-300 focus:bg-[#252535] focus:border-indigo-500/40 placeholder:text-white/30"
                        />
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-white/40 group-focus-within:text-indigo-400 transition-colors duration-300 pointer-events-none" />
                    </div>
                </div>

                {/* List Container */}
                <div className="flex-1 overflow-y-auto px-4 pb-4 scroll-smooth"
                    style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.05) transparent' }}>

                    <div className="flex flex-col gap-1.5 pb-2 relative">
                        <AnimatePresence mode='popLayout'>
                            {loading && (
                                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-center py-10">
                                    <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
                                </motion.div>
                            )}

                            {error && (
                                <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center text-red-400/80 text-sm py-5 font-inter bg-red-500/10 rounded-xl p-3 border border-red-500/20">
                                    {error}
                                </motion.div>
                            )}

                            {!loading && !error && filteredDialogs.length === 0 && (
                                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center text-white/30 text-sm py-10 font-inter">
                                    No conversations found matching "{searchQuery}"
                                </motion.div>
                            )}

                            {!loading && !error && filteredDialogs.map((chat) => {
                                const idStr = chat.entity?.id?.toString() || Math.random().toString()
                                const isMe = idStr === myId?.toString()
                                const title = isMe ? "Saved Messages" : (chat.title || "Deleted Account")
                                const msg = chat.message?.message || "No messages"
                                const dateRaw = chat.message?.date
                                const date = dateRaw ? formatTime(dateRaw) : ''
                                const titleText = chat.title ? chat.title.trim() : "U"
                                const initials = titleText ? Array.from(titleText)[0].toUpperCase() : "U"

                                // Generate deterministic gradient class based on ID
                                const gradients = [
                                    "from-blue-500 to-cyan-400",
                                    "from-purple-500 to-pink-400",
                                    "from-emerald-500 to-teal-400",
                                    "from-orange-500 to-amber-400",
                                    "from-rose-500 to-red-400"
                                ]
                                const colorIndex = Math.abs(parseInt(idStr.slice(-5) || '0', 16)) % gradients.length
                                const avatarBg = isMe ? "bg-[#353545] border border-white/10" : `bg-gradient-to-br ${gradients[colorIndex]}`

                                return (
                                    <motion.div
                                        layout
                                        variants={itemVariants}
                                        initial="hidden"
                                        animate="visible"
                                        exit="exit"
                                        key={idStr}
                                        onClick={() => handleChatClick(chat)}
                                        className={`group relative flex items-center p-3 rounded-[18px] cursor-pointer transition-colors duration-200 overflow-hidden ${isMe
                                            ? 'bg-white/5 hover:bg-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]'
                                            : 'hover:bg-white-[0.03] hover:backdrop-brightness-125 border border-transparent'
                                            }`}
                                    >
                                        <div className={`w-[50px] h-[50px] rounded-full flex items-center justify-center mr-4 shrink-0 font-bold text-white shadow-lg ${avatarBg}`}>
                                            {isMe ? <Bookmark className="w-5 h-5 fill-white/80 text-white/80" /> : <span className="text-[1.1rem] tracking-wide">{initials}</span>}
                                        </div>

                                        <div className="flex-1 min-w-0 pr-2">
                                            <div className="flex justify-between items-center mb-0.5">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <span className={`font-inter font-medium text-[0.95rem] truncate ${isMe ? 'text-white' : 'text-white/90 group-hover:text-white transition-colors'}`}>
                                                        {title}
                                                    </span>
                                                    {isMe && <span className="text-[10px] text-white/30 italic tracking-wider shrink-0 mt-[2px]">Recommended</span>}
                                                </div>
                                                <span className="text-[0.7rem] text-white/30 shrink-0 ml-2 font-medium">{date}</span>
                                            </div>
                                            <p className="text-[0.85rem] text-white/40 truncate font-inter group-hover:text-white/50 transition-colors">
                                                {msg}
                                            </p>
                                        </div>
                                    </motion.div>
                                )
                            })}
                        </AnimatePresence>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    )
}
