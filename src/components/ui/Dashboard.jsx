import React, { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { getChatHistory, getDialogs, getMe, getProfilePhoto, getChatFolders, sendMessage } from '../../services/telegramClient'
import { motion, AnimatePresence } from 'framer-motion'
import './terminal-mode.css'

export default function Dashboard() {
    const { selectedChatId, setPostLoginView, setSelectedChatId } = useStore()
    const [messages, setMessages] = useState([])
    const [dialogs, setDialogs] = useState([])
    const [myId, setMyId] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [activeTab, setActiveTab] = useState('all') // 'all', 'photo', 'video', 'archive'
    const [activeSection, setActiveSection] = useState('main') // 'main', 'chats'
    const [avatarUrls, setAvatarUrls] = useState({})
    const [chatFolder, setChatFolder] = useState(0) // 0 = regular, 1 = archive, 2+ = custom folders
    const [showChatMenu, setShowChatMenu] = useState(false)
    const [chatFolders, setChatFolders] = useState([])
    const [terminalMode, setTerminalMode] = useState(false)
    const [draftMessage, setDraftMessage] = useState('')
    const chatMenuRef = useRef(null)
    const allDialogsCache = useRef(null) // cache all dialogs for custom folder filtering
    const chatFoldersRef = useRef([]) // ref to avoid triggering re-fetches

    // Keep ref in sync
    useEffect(() => { chatFoldersRef.current = chatFolders }, [chatFolders])

    useEffect(() => {
        let mounted = true
        async function fetchChats() {
            try {
                const me = await getMe()
                if (mounted) setMyId(me.id)
                let fetchedDialogs

                if (chatFolder <= 1) {
                    // Built-in folders: 0 = all chats, 1 = archive
                    try {
                        fetchedDialogs = await getDialogs(50, chatFolder)
                    } catch (e) {
                        console.warn('Failed to fetch folder', chatFolder, ':', e)
                        fetchedDialogs = await getDialogs(50, 0)
                    }
                    // Cache all dialogs when viewing folder 0
                    if (chatFolder === 0 && Array.isArray(fetchedDialogs)) {
                        allDialogsCache.current = fetchedDialogs
                    }
                } else {
                    // Custom folder — use cached dialogs or fetch once
                    const folders = chatFoldersRef.current
                    const folder = folders.find(f => f.id === chatFolder)

                    if (!allDialogsCache.current) {
                        try {
                            const [mainChats, archiveChats] = await Promise.all([
                                getDialogs(800, 0),
                                getDialogs(400, 1)
                            ])
                            const combined = [...(Array.isArray(mainChats) ? mainChats : []), ...(Array.isArray(archiveChats) ? archiveChats : [])]

                            // Deduplicate
                            const seen = new Set()
                            const unique = []
                            for (const d of combined) {
                                const eid = d.entity?.id?.toString()
                                if (eid && !seen.has(eid)) {
                                    seen.add(eid)
                                    unique.push(d)
                                }
                            }
                            allDialogsCache.current = unique
                        } catch (e) {
                            console.warn('Failed to fetch dialogs for filtering:', e)
                            allDialogsCache.current = []
                        }
                    }
                    fetchedDialogs = [...(allDialogsCache.current || [])]

                    if (folder && Array.isArray(fetchedDialogs)) {
                        const allIncluded = new Set([
                            ...folder.includePeers,
                            ...folder.pinnedPeers,
                        ])
                        fetchedDialogs = fetchedDialogs.filter(chat => {
                            const entityId = chat.entity?.id?.toString()
                            if (!entityId) return false

                            // Exclude explicit peers
                            if (folder.excludePeers.includes(entityId)) return false

                            // Always include explicit peers, bypassing type flags
                            if (allIncluded.has(entityId)) return true

                            // Exclude flags
                            const isArchived = chat.folderId === 1 || chat.dialog?.folderId === 1
                            if (folder.excludeArchived && isArchived) return false
                            if (folder.excludeMuted && chat.dialog?.notifySettings?.muteUntil > (Date.now() / 1000)) return false
                            if (folder.excludeRead && chat.unreadCount === 0) return false

                            // Match type flags
                            const entity = chat.entity
                            const className = entity?.className || ''
                            if (folder.groups && (className === 'Chat' || className === 'ChatForbidden' || (className === 'Channel' && entity.megagroup))) return true
                            if (folder.broadcasts && className === 'Channel' && !entity.megagroup) return true
                            if (folder.bots && entity?.bot) return true
                            if (folder.contacts && className === 'User' && !entity.bot && entity.contact) return true
                            if (folder.nonContacts && className === 'User' && !entity.bot && !entity.contact) return true

                            return false
                        })
                        // Pin pinned peers to top
                        if (folder.pinnedPeers.length > 0) {
                            const pinned = []
                            const rest = []
                            for (const d of fetchedDialogs) {
                                const eid = d.entity?.id?.toString()
                                if (eid && folder.pinnedPeers.includes(eid)) {
                                    pinned.push(d)
                                } else {
                                    rest.push(d)
                                }
                            }
                            // Sort pinned in the same order as pinnedPeers
                            pinned.sort((a, b) => {
                                const ai = folder.pinnedPeers.indexOf(a.entity?.id?.toString())
                                const bi = folder.pinnedPeers.indexOf(b.entity?.id?.toString())
                                return ai - bi
                            })
                            fetchedDialogs = [...pinned, ...rest]
                        }
                    }
                }

                if (!Array.isArray(fetchedDialogs)) fetchedDialogs = []
                if (mounted) {
                    setDialogs(fetchedDialogs)
                    // Load avatars in background
                    fetchedDialogs.forEach(async (chat) => {
                        const entity = chat.entity
                        if (!entity) return
                        const idStr = entity.id?.toString()
                        if (!idStr) return
                        if (avatarUrls[idStr]) return // already cached
                        try {
                            const url = await getProfilePhoto(entity)
                            if (mounted && url) {
                                setAvatarUrls(prev => ({ ...prev, [idStr]: url }))
                            }
                        } catch { /* ignore */ }
                    })
                }
            } catch (err) {
                console.error('Failed to fetch dialogs:', err)
            }
        }
        fetchChats()
        return () => { mounted = false }
    }, [chatFolder])

    // Refresh folders & clear cache when entering chats section
    useEffect(() => {
        if (activeSection === 'chats') {
            allDialogsCache.current = null // invalidate cache
            getChatFolders().then(folders => {
                setChatFolders(folders)
            })
        }
    }, [activeSection])

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e) {
            if (chatMenuRef.current && !chatMenuRef.current.contains(e.target)) {
                setShowChatMenu(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [])

    useEffect(() => {
        if (!selectedChatId) return

        let mounted = true
        setLoading(true)
        setError(null)

        const fetchHistory = async () => {
            try {
                // Fetch up to 100 messages for the initial view
                const history = await getChatHistory(selectedChatId, { limit: 100 })
                if (mounted) {
                    setMessages(history)
                    setLoading(false)
                }
            } catch (err) {
                console.error("Failed to load chat history:", err)
                if (mounted) {
                    setError(err.message)
                    setLoading(false)
                }
            }
        }
        fetchHistory()
        return () => { mounted = false }
    }, [selectedChatId])

    const handleBack = () => {
        setPostLoginView('chats')
    }

    const handleSendMessage = async (e) => {
        if (e) e.preventDefault()
        if (!draftMessage.trim() || !selectedChatId) return

        const msgText = draftMessage
        setDraftMessage('')

        // Optimistically add message
        const now = Math.floor(Date.now() / 1000)
        const optimisticMsg = {
            id: 'temp_' + now,
            message: msgText,
            out: true,
            date: now,
            sender: { id: myId, firstName: 'Вы' }
        }
        setMessages(prev => [optimisticMsg, ...prev])

        try {
            await sendMessage(selectedChatId, msgText)
            // Ideally re-fetch or rely on a websocket update, but for now optimistic UI is enough
        } catch (err) {
            console.error('Failed to send message:', err)
            // Revert message on failure could be implemented here
        }
    }

    const renderFileRows = () => {
        if (loading) {
            return <div className="p-8 text-center text-[#787c99]">Загрузка файлов...</div>
        }
        if (error) {
            return <div className="p-8 text-center text-red-400">Ошибка: {error}</div>
        }

        // Filter messages to only those with media/documents
        const fileMessages = messages.filter(msg => {
            if (!msg.media) return false;

            if (activeTab === 'all') return true;

            if (activeTab === 'photo') {
                return !!msg.media.photo;
            }

            if (msg.media.document) {
                const attributes = msg.media.document.attributes || [];
                if (activeTab === 'video') {
                    return attributes.some(a => a.className === 'DocumentAttributeVideo') || msg.media.document.mimeType?.startsWith('video/');
                }
                if (activeTab === 'archive') {
                    const mime = (msg.media.document.mimeType || '').toLowerCase();
                    return mime.includes('zip') || mime.includes('rar') || mime.includes('tar') || mime.includes('7z') || mime.includes('archive');
                }
            }
            return false;
        });

        if (fileMessages.length === 0) {
            return (
                <div className="flex-1 border-2 border-dashed border-[#5e5e75] rounded-3xl bg-[#16161e]/50 flex items-center justify-center p-8 text-center transition-all duration-300 hover:border-[#7aa2f7] hover:bg-[#16161e]/80 min-h-[300px]">
                    <div className="max-w-sm w-full mx-auto flex flex-col items-center">
                        <div className="mb-6 relative w-24 h-24 flex items-center justify-center">
                            <svg width="100" height="100" viewBox="0 0 120 120" fill="none" className="drop-shadow-[0_10px_20px_rgba(0,0,0,0.3)]">
                                <rect x="30" y="30" width="40" height="50" fill="#212129" stroke="#5e5e75" strokeWidth="2" transform="rotate(-15)" />
                                <rect x="50" y="30" width="40" height="50" fill="#2a2a35" stroke="#7aa2f7" strokeWidth="2" transform="rotate(10)" />
                                <circle cx="60" cy="60" r="15" fill="#9ece6a" opacity="0.8" />
                            </svg>
                        </div>
                        <p className="text-[#a1a1aa] text-lg mb-6 leading-relaxed">Перетащите сюда файлы для загрузки</p>
                    </div>
                </div>
            )
        }

        return (
            <div className="flex-1 overflow-y-auto scrollable bg-[#212129] rounded-2xl border border-[#2a2a35] relative list-wrapper">
                <div className="flex flex-col relative w-full h-full min-h-0">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            transition={{ duration: 0.1, ease: "easeOut" }}
                            className="flex flex-col w-full h-full min-h-0 divide-y divide-[#2a2a35]"
                        >
                            {fileMessages.map(msg => {
                                const media = msg.media
                                let typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                                let fileName = "Файл"
                                let fileSize = ""
                                let fileUrl = ""

                                if (media.document) {
                                    const attributes = media.document.attributes || []
                                    const filenameAttr = attributes.find(attr => attr.className === 'DocumentAttributeFilename')
                                    if (filenameAttr) {
                                        fileName = filenameAttr.fileName
                                    } else {
                                        // Fallback if it's a generic document without explicitly set file name (e.g. voice note, sticker)
                                        if (attributes.find(a => a.className === 'DocumentAttributeVideo')) fileName = "Видео"
                                        else if (attributes.find(a => a.className === 'DocumentAttributeAudio')) fileName = "Аудио"
                                        else if (attributes.find(a => a.className === 'DocumentAttributeSticker')) fileName = "Стикер"
                                    }

                                    fileSize = (media.document.size / 1024 / 1024).toFixed(2) + " MB"

                                    // Select icon based on attributes
                                    if (attributes.find(a => a.className === 'DocumentAttributeVideo')) {
                                        typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>
                                    } else if (attributes.find(a => a.className === 'DocumentAttributeAudio')) {
                                        typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                                    } else {
                                        typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                                    }
                                } else if (media.photo) {
                                    fileName = "Фотография"
                                    typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                                } else if (media.webpage) {
                                    fileName = media.webpage.title || "Веб-страница"
                                    fileUrl = media.webpage.url || media.webpage.displayUrl || ""
                                    typeIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                                }

                                const dateObj = new Date(msg.date * 1000)
                                const dateStr = dateObj.toLocaleDateString() + " " + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

                                return (
                                    <div
                                        key={msg.id}
                                        className="file-row w-full flex items-center justify-between px-6 py-4 hover:bg-[#16161e]/80 transition-colors group"
                                    >
                                        <div className="flex items-center gap-4 flex-1 min-w-0 pr-4">
                                            <div className="w-10 h-10 shrink-0 rounded-xl bg-white/5 flex items-center justify-center text-[#787c99] group-hover:text-blue-400 group-hover:bg-blue-500/10 transition-colors">
                                                <div className="w-5 h-5">{typeIcon}</div>
                                            </div>
                                            <div className="flex flex-col min-w-0 gap-1 overflow-hidden" style={{ flex: '1 1 auto', maxWidth: '300px' }}>
                                                <span className="text-[0.95rem] text-gray-200 font-medium whitespace-nowrap overflow-hidden text-ellipsis block w-full leading-tight" title={fileName}>
                                                    {fileName}
                                                </span>
                                                <div className="text-[0.75rem] text-gray-400/80 flex items-center gap-2 whitespace-nowrap">
                                                    {fileSize && <span>{fileSize}</span>}
                                                    {fileSize && <span className="w-1 h-1 rounded-full bg-white/20"></span>}
                                                    <span>{dateStr}</span>
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0 flex items-center shrink">
                                                {fileUrl && (
                                                    <a href={fileUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[0.8rem] text-blue-400/70 group-hover:text-blue-400 hover:!underline whitespace-nowrap overflow-hidden text-ellipsis max-w-full block" title={fileUrl}>
                                                        {fileUrl}
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                        <div className="file-actions opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center">
                                            <button className="p-2 bg-white/5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>
        )
    }

    const chatContainerRef = useRef(null)

    // Force scroll to bottom after messages render
    useLayoutEffect(() => {
        // Small delay to ensure DOM is fully painted
        requestAnimationFrame(() => {
            const el = chatContainerRef.current
            if (el) {
                el.scrollTop = el.scrollHeight
            }
        })
    }, [messages, selectedChatId, loading, activeSection])

    const renderChatMessages = () => {
        if (loading) {
            return (
                <div className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-[#7aa2f7] border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-[#787c99] text-sm">Загрузка сообщений...</span>
                    </div>
                </div>
            )
        }
        if (error) {
            return <div className="flex-1 flex items-center justify-center text-red-400">Ошибка: {error}</div>
        }

        const chatMessages = [...messages].reverse()
        let lastDate = ''

        // ─── TERMINAL MODE: IRC-style log ───
        if (terminalMode) {
            return (
                <div ref={chatContainerRef} className="flex-1 overflow-y-auto scrollable bg-black">
                    <div className="px-3 py-2" style={{ fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6' }}>
                        {chatMessages.length === 0 ? (
                            <div style={{ color: '#555' }}>--- нет сообщений ---</div>
                        ) : (
                            chatMessages.map(msg => {
                                const dateObj = new Date(msg.date * 1000)
                                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                const dateStr = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
                                const showDate = dateStr !== lastDate
                                lastDate = dateStr
                                const name = msg.out ? 'you' : (msg.sender?.firstName || msg.sender?.title || '???')
                                const text = msg.message || '[attachment]'

                                return (
                                    <React.Fragment key={msg.id}>
                                        {showDate && (
                                            <div style={{ color: '#555', margin: '4px 0' }}>--- {dateStr} ---</div>
                                        )}
                                        <div style={{ color: msg.out ? '#b0b0b0' : '#e0e0e0' }}>
                                            <span style={{ color: '#666' }}>[{timeStr}]</span>{' '}
                                            <span style={{ color: msg.out ? '#5faf5f' : '#5fafff' }}>&lt;{name}&gt;</span>{' '}
                                            <span>{text}</span>
                                        </div>
                                    </React.Fragment>
                                )
                            })
                        )}
                    </div>
                </div>
            )
        }

        // ─── NORMAL MODE: bubbles ───

        return (
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto scrollable rounded-2xl bg-[#1a1b26] relative">
                <div className="flex flex-col gap-0 px-4 py-4">
                    {chatMessages.length === 0 ? (
                        <div className="flex items-center justify-center py-20 text-[#787c99] text-sm">Нет сообщений</div>
                    ) : (
                        chatMessages.map((msg, i) => {
                            const isOut = msg.out
                            const dateObj = new Date(msg.date * 1000)
                            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            const dateStr = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
                            const showDate = dateStr !== lastDate
                            lastDate = dateStr

                            const prevMsg = i > 0 ? chatMessages[i - 1] : null
                            const senderId = msg.sender?.id?.toString() || (isOut ? 'me' : '')
                            const prevSenderId = prevMsg?.sender?.id?.toString() || (prevMsg?.out ? 'me' : '')
                            const isContinuation = prevMsg && prevSenderId === senderId && !showDate

                            const senderName = isOut ? 'Вы' : (msg.sender ? (msg.sender.firstName || msg.sender.title || '') : '')

                            return (
                                <React.Fragment key={msg.id}>
                                    {showDate && (
                                        <div className="flex items-center justify-center my-3">
                                            <div className="px-4 py-1.5 rounded-full bg-[#2a2a35]/80 text-[#787c99] text-[11px] font-medium backdrop-blur-sm">
                                                {dateStr}
                                            </div>
                                        </div>
                                    )}
                                    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} ${isContinuation ? 'mt-[2px]' : 'mt-2'}`}>
                                        <div className={`max-w-[70%] flex flex-col ${isOut ? 'items-end' : 'items-start'}`}>
                                            {senderName && !isContinuation && (
                                                <span className={`text-[11px] font-semibold mb-1 px-2 ${isOut ? 'text-[#9ece6a]' : 'text-[#7aa2f7]'}`}>{senderName}</span>
                                            )}
                                            <div className={`relative px-3.5 py-2 ${isOut
                                                ? `bg-[#7aa2f7] text-[#0f0f14] ${isContinuation ? 'rounded-2xl rounded-tr-lg' : 'rounded-2xl rounded-br-sm'}`
                                                : `bg-[#2a2a35] text-[#e4e4e7] ${isContinuation ? 'rounded-2xl rounded-tl-lg' : 'rounded-2xl rounded-bl-sm'}`
                                                }`}>
                                                {msg.message ? (
                                                    <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.45]">{msg.message}</p>
                                                ) : (
                                                    <p className="text-[14px] italic opacity-60">[Вложение]</p>
                                                )}
                                                <div className={`flex items-center gap-1.5 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                                                    <span className={`text-[10px] ${isOut ? 'text-[#0f0f14]/50' : 'text-[#787c99]'}`}>{timeStr}</span>
                                                    {isOut && (
                                                        <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3.5 h-3.5 ${msg.views !== undefined ? 'text-[#0f0f14]/40' : 'text-[#0f0f14]/50'}`}>
                                                            <path d="M1.5 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </React.Fragment>
                            )
                        })
                    )}
                </div>
            </div>
        )
    }

    const navItems = [
        { id: 'all', label: 'Все файлы', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg> },
        { id: 'photo', label: 'Фото', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> },
        { id: 'video', label: 'Видео', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg> },
        { id: 'archive', label: 'Архивы', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg> },
    ]

    return (
        <>

            <div id="dashboard-view" className={`fixed inset-0 z-[2000] bg-[#1a1b26] text-white font-manrope overflow-hidden flex flex-col md:flex-row ${terminalMode ? 'terminal-mode' : ''}`}>
                <div className="flex h-full w-full bg-[#16161e]">
                    {/* Sidebar Rail */}
                    {terminalMode ? (
                        <aside className="w-[76px] flex flex-col items-center py-4 border-r border-[#5e5e75] bg-[#16161e]/90 z-10 shrink-0" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                            <div className="mb-6 text-center" style={{ color: '#666' }}>INS</div>
                            <div className="flex flex-col gap-1 w-full px-1">
                                <div
                                    onClick={() => setActiveSection('main')}
                                    className={`text-center py-2 cursor-pointer select-none ${activeSection === 'main' ? 'text-white' : 'text-[#787c99] hover:text-white'}`}
                                    style={{ fontFamily: 'monospace', fontSize: '11px', background: activeSection === 'main' ? '#111' : 'transparent' }}
                                >[H]</div>
                                <div
                                    onClick={() => setActiveSection('chats')}
                                    className={`text-center py-2 cursor-pointer select-none ${activeSection === 'chats' ? 'text-white' : 'text-[#787c99] hover:text-white'}`}
                                    style={{ fontFamily: 'monospace', fontSize: '11px', background: activeSection === 'chats' ? '#111' : 'transparent' }}
                                >[C]</div>
                            </div>
                            <div className="mt-auto flex flex-col gap-1 mb-2 w-full px-1">
                                <div
                                    onClick={() => setTerminalMode(prev => !prev)}
                                    className="text-center py-2 cursor-pointer select-none"
                                    style={{ fontFamily: 'monospace', fontSize: '11px', color: '#5fafff', background: '#111' }}
                                >[&gt;_]</div>
                                <div
                                    onClick={() => setPostLoginView(null)}
                                    className="text-center py-2 cursor-pointer select-none text-[#787c99] hover:text-white"
                                    style={{ fontFamily: 'monospace', fontSize: '11px' }}
                                >[X]</div>
                            </div>
                        </aside>
                    ) : (
                        <aside className="w-[76px] flex flex-col items-center py-6 border-r border-[#5e5e75] bg-[#16161e]/90 z-10 shrink-0">
                            <button className="logo-btn mb-8 flexitems-center justify-center transition-transform hover:scale-105" onClick={handleBack} title="Back to Chats">
                                <svg viewBox="0 0 64 64" fill="none" stroke="#e4e4e7" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="w-[44px] h-[44px]">
                                    <circle cx="32" cy="32" r="13" />
                                    <ellipse cx="32" cy="32" rx="26" ry="9" transform="rotate(-35 32 32)" strokeDasharray="20 8" />
                                    <ellipse cx="32" cy="32" rx="20" ry="5" transform="rotate(-35 32 32)" strokeWidth="2" opacity="0.6" strokeDasharray="4 4" />
                                    <circle cx="12" cy="42" r="3" fill="#e4e4e7" stroke="none" />
                                    <circle cx="56" cy="18" r="2.5" fill="#e4e4e7" stroke="none" />
                                </svg>
                            </button>
                            <div className="flex flex-col gap-6 w-full px-2">
                                <div
                                    onClick={() => setActiveSection('main')}
                                    className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl cursor-pointer select-none group transition-all duration-300 ${activeSection === 'main' ? 'text-white' : 'text-[#787c99] hover:text-white'}`}>
                                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[22px] h-[22px]"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg>
                                    <span className="text-[11px] whitespace-nowrap font-manrope">Главная</span>
                                </div>
                                <div
                                    onClick={() => setActiveSection('chats')}
                                    className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl cursor-pointer select-none group transition-all duration-300 ${activeSection === 'chats' ? 'text-white' : 'text-[#787c99] hover:text-white'}`}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px]"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                                    <span className="text-[11px] whitespace-nowrap font-manrope">Чаты</span>
                                </div>
                            </div>
                            <div className="mt-auto flex flex-col gap-4 mb-4">
                                <button onClick={() => setTerminalMode(prev => !prev)} className={`p-2.5 rounded-xl transition-colors ${terminalMode ? 'text-[#00ff41] bg-[#00ff41]/10' : 'text-[#787c99] hover:text-white hover:bg-white/5'}`} title="Терминальный режим">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px]">
                                        <polyline points="4 17 10 11 4 5"></polyline>
                                        <line x1="12" y1="19" x2="20" y2="19"></line>
                                    </svg>
                                </button>
                                <button onClick={() => setPostLoginView(null)} className="p-2.5 rounded-xl text-[#787c99] hover:text-white hover:bg-white/5 transition-colors" title="Выйти на сайт">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px]">
                                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                        <polyline points="16 17 21 12 16 7"></polyline>
                                        <line x1="21" y1="12" x2="9" y2="12"></line>
                                    </svg>
                                </button>
                            </div>
                        </aside>
                    )}

                    {/* Sidebar Explorer */}
                    <aside className="hidden md:flex flex-col w-[280px] border-r border-[#5e5e75] bg-[#16161e] shrink-0">
                        {terminalMode ? (
                            <>
                                <div className="h-[73px] flex shrink-0 items-center px-4 border-b border-[#5e5e75]" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                                    <span style={{ color: '#5fafff' }}>$</span>
                                    <span style={{ color: '#e0e0e0', marginLeft: '8px' }}>
                                        {activeSection === 'main' ? 'ls ~/files' : (
                                            chatFolder === 0 ? 'ls ~/chats' :
                                                chatFolder === 1 ? 'ls ~/archive' :
                                                    `ls ~/${(chatFolders.find(f => f.id === chatFolder)?.title || 'chats').toLowerCase()}`
                                        )}
                                    </span>
                                    {activeSection === 'chats' && (
                                        <div className="relative ml-auto" ref={chatMenuRef}>
                                            <button
                                                onClick={() => setShowChatMenu(prev => !prev)}
                                                style={{ fontFamily: 'monospace', fontSize: '12px', color: '#666', padding: '2px 6px', cursor: 'pointer', background: 'transparent', border: '1px solid #333' }}
                                            >[cd]</button>
                                            {showChatMenu && (
                                                <div className="absolute right-0 top-full mt-1 w-[200px] z-50 overflow-hidden max-h-[320px] overflow-y-auto" style={{ fontFamily: 'monospace', fontSize: '12px', background: '#0a0a0a', border: '1px solid #333' }}>
                                                    <div
                                                        onClick={() => { setChatFolder(0); setShowChatMenu(false) }}
                                                        style={{ padding: '4px 10px', cursor: 'pointer', color: chatFolder === 0 ? '#5fafff' : '#b0b0b0', background: chatFolder === 0 ? '#111' : 'transparent' }}
                                                    >{chatFolder === 0 ? '>' : ' '} ~/chats</div>
                                                    <div
                                                        onClick={() => { setChatFolder(1); setShowChatMenu(false) }}
                                                        style={{ padding: '4px 10px', cursor: 'pointer', color: chatFolder === 1 ? '#5fafff' : '#b0b0b0', background: chatFolder === 1 ? '#111' : 'transparent' }}
                                                    >{chatFolder === 1 ? '>' : ' '} ~/archive</div>
                                                    {chatFolders.length > 0 && (
                                                        <div style={{ borderTop: '1px solid #333', margin: '2px 0' }}></div>
                                                    )}
                                                    {chatFolders.map(folder => (
                                                        <div
                                                            key={folder.id}
                                                            onClick={() => { setChatFolder(folder.id); setShowChatMenu(false) }}
                                                            style={{ padding: '4px 10px', cursor: 'pointer', color: chatFolder === folder.id ? '#5fafff' : '#b0b0b0', background: chatFolder === folder.id ? '#111' : 'transparent' }}
                                                        >{chatFolder === folder.id ? '>' : ' '} ~/{folder.title.toLowerCase()}</div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="py-2 flex flex-col overflow-y-auto scrollable flex-1 min-h-0 terminal-list" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                                    {activeSection === 'main' && navItems.map(item => (
                                        <div
                                            key={item.id}
                                            onClick={() => setActiveTab(item.id)}
                                            style={{ padding: '3px 12px', cursor: 'pointer', color: activeTab === item.id ? '#5fafff' : '#b0b0b0', background: activeTab === item.id ? '#111' : 'transparent', flexShrink: 0 }}
                                        >{activeTab === item.id ? '>' : ' '} {item.label.toLowerCase()}/</div>
                                    ))}
                                    {activeSection === 'chats' && dialogs.map((chat) => {
                                        const idStr = chat.entity?.id?.toString() || Math.random().toString()
                                        const isMe = idStr === myId?.toString()
                                        const title = isMe ? 'saved_messages' : (chat.title || 'deleted').toLowerCase().replace(/\s+/g, '_')
                                        const isSelected = selectedChatId === idStr
                                        const unreadCount = chat.unreadCount || 0
                                        const msgTime = chat.message?.date ? new Date(chat.message.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

                                        return (
                                            <div
                                                key={idStr}
                                                onClick={() => setSelectedChatId(idStr)}
                                                style={{
                                                    padding: '7px 12px',
                                                    cursor: 'pointer',
                                                    color: isSelected ? '#5fafff' : '#b0b0b0',
                                                    background: isSelected ? '#111' : 'transparent',
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    display: 'flex',
                                                    flexShrink: 0,
                                                    gap: '0',
                                                    borderBottom: '1px solid #1a1a1a',
                                                }}
                                            >
                                                <span style={{ color: isSelected ? '#5fafff' : '#555', flexShrink: 0 }}>{isSelected ? '> ' : '  '}</span>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                                                {unreadCount > 0 && <span style={{ color: '#d75f5f', marginLeft: '4px', flexShrink: 0 }}>({unreadCount})</span>}
                                                {msgTime && <span style={{ color: '#444', marginLeft: 'auto', paddingLeft: '8px', flexShrink: 0 }}>{msgTime}</span>}
                                            </div>
                                        )
                                    })}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="h-[73px] flex shrink-0 items-center justify-between px-6 border-b border-[#5e5e75]">
                                    <h2 className="text-[22px] font-manrope font-medium text-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]">
                                        {activeSection === 'main' ? 'Главная' : (
                                            chatFolder === 0 ? 'Чаты' :
                                                chatFolder === 1 ? 'Архив' :
                                                    (chatFolders.find(f => f.id === chatFolder)?.title || 'Чаты')
                                        )}
                                    </h2>
                                    {activeSection === 'chats' && (
                                        <div className="relative" ref={chatMenuRef}>
                                            <button
                                                onClick={() => setShowChatMenu(prev => !prev)}
                                                className="flex items-center gap-1 p-1.5 rounded-lg text-[#787c99] hover:text-white hover:bg-white/5 transition-all"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-[18px] h-[18px] transition-transform duration-200 ${showChatMenu ? 'rotate-180' : ''}`}>
                                                    <polyline points="6 9 12 15 18 9"></polyline>
                                                </svg>
                                            </button>
                                            {showChatMenu && (
                                                <div className="absolute right-0 top-full mt-2 w-[200px] bg-[#1e1e2e] border border-[#5e5e75]/50 rounded-xl shadow-xl shadow-black/40 z-50 py-1.5 overflow-hidden max-h-[320px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                                                    <button
                                                        onClick={() => { setChatFolder(0); setShowChatMenu(false) }}
                                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors ${chatFolder === 0 ? 'text-[#7aa2f7] bg-[#7aa2f7]/10' : 'text-[#a0a4b8] hover:text-white hover:bg-white/5'}`}
                                                    >
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                                                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                                        </svg>
                                                        Все чаты
                                                    </button>
                                                    <button
                                                        onClick={() => { setChatFolder(1); setShowChatMenu(false) }}
                                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors ${chatFolder === 1 ? 'text-[#7aa2f7] bg-[#7aa2f7]/10' : 'text-[#a0a4b8] hover:text-white hover:bg-white/5'}`}
                                                    >
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0">
                                                            <polyline points="21 8 21 21 3 21 3 8"></polyline>
                                                            <rect x="1" y="3" width="22" height="5"></rect>
                                                            <line x1="10" y1="12" x2="14" y2="12"></line>
                                                        </svg>
                                                        Архив
                                                    </button>
                                                    {chatFolders.length > 0 && (
                                                        <div className="border-t border-[#5e5e75]/30 my-1"></div>
                                                    )}
                                                    {chatFolders.map(folder => (
                                                        <button
                                                            key={folder.id}
                                                            onClick={() => { setChatFolder(folder.id); setShowChatMenu(false) }}
                                                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors ${chatFolder === folder.id ? 'text-[#7aa2f7] bg-[#7aa2f7]/10' : 'text-[#a0a4b8] hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            <span className="w-4 h-4 shrink-0 flex items-center justify-center text-[14px]">
                                                                {folder.emoji || '📁'}
                                                            </span>
                                                            <span className="truncate">{folder.title}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="py-4 flex flex-col gap-1.5 overflow-y-auto scrollable flex-1 min-h-0">
                                    {activeSection === 'main' && navItems.map(item => (
                                        <div
                                            key={item.id}
                                            onClick={() => setActiveTab(item.id)}
                                            className={`menu-item mx-4 flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl cursor-pointer select-none text-[0.9rem] font-medium transition-colors ${activeTab === item.id
                                                ? 'text-[#7aa2f7] bg-[#7aa2f7]/10'
                                                : 'text-[#787c99] hover:bg-white/5'
                                                }`}
                                        >
                                            {item.icon}
                                            <span>{item.label}</span>
                                        </div>
                                    ))}
                                    {activeSection === 'chats' && dialogs.map((chat) => {
                                        const idStr = chat.entity?.id?.toString() || Math.random().toString()
                                        const isMe = idStr === myId?.toString()
                                        const title = isMe ? "Saved Messages" : (chat.title || "Deleted Account")
                                        const msgText = chat.message?.message || ""
                                        const isSelected = selectedChatId === idStr

                                        const titleText = chat.title ? chat.title.trim() : "U"
                                        const initials = titleText ? Array.from(titleText)[0].toUpperCase() : "U"
                                        const gradients = [
                                            "from-blue-500 to-cyan-400",
                                            "from-purple-500 to-pink-400",
                                            "from-emerald-500 to-teal-400",
                                            "from-orange-500 to-amber-400",
                                            "from-rose-500 to-red-400"
                                        ]
                                        const colorIndex = Math.abs(parseInt(idStr.slice(-5) || '0', 16)) % gradients.length
                                        const avatarBg = isMe ? "bg-[#353545] border border-white/10" : `bg-gradient-to-br ${gradients[colorIndex]}`

                                        const msgTime = chat.message?.date ? new Date(chat.message.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
                                        const unreadCount = chat.unreadCount || 0
                                        const avatarUrl = avatarUrls[idStr]

                                        return (
                                            <div
                                                key={idStr}
                                                onClick={() => setSelectedChatId(idStr)}
                                                className={`menu-item group flex mx-3 items-center gap-3.5 px-3 py-3 rounded-[16px] cursor-pointer select-none transition-all duration-200 ${isSelected
                                                    ? 'bg-[#7aa2f7]/15 ring-1 ring-[#7aa2f7]/30 shadow-sm'
                                                    : 'hover:bg-white/[0.04]'
                                                    }`}
                                            >
                                                <div className="relative shrink-0">
                                                    {avatarUrl ? (
                                                        <img
                                                            src={avatarUrl}
                                                            alt=""
                                                            className="w-[44px] h-[44px] rounded-full object-cover shadow-md transition-transform group-hover:scale-[1.04]"
                                                        />
                                                    ) : (
                                                        <div className={`w-[44px] h-[44px] rounded-full flex items-center justify-center text-white font-semibold text-[15px] shadow-md transition-transform group-hover:scale-[1.04] ${avatarBg}`}>
                                                            {isMe ? (
                                                                <svg viewBox="0 0 24 24" fill="currentColor" className="w-[20px] h-[20px]"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z" /></svg>
                                                            ) : initials}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex flex-col min-w-0 flex-1 justify-center gap-[3px]">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className={`text-[14px] truncate font-medium tracking-[0.01em] ${isSelected ? 'text-[#7aa2f7]' : 'text-gray-100 group-hover:text-white transition-colors'}`}>
                                                            {title}
                                                        </span>
                                                        {msgTime && (
                                                            <span className={`text-[10px] shrink-0 font-medium ${unreadCount > 0 ? 'text-[#7aa2f7]' : 'text-[#5e5e75] group-hover:text-[#787c99]'} transition-colors`}>
                                                                {msgTime}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className={`text-[12px] truncate font-normal leading-[1.3] ${isSelected ? 'text-[#7aa2f7]/70' : 'text-[#787c99] group-hover:text-[#9ea3c4]'} transition-colors`}>
                                                            {msgText || "Нет сообщений"}
                                                        </span>
                                                        {unreadCount > 0 && (
                                                            <div className="shrink-0 flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#7aa2f7] text-[#16161e] text-[10px] font-bold shadow-sm">
                                                                {unreadCount > 99 ? '99+' : unreadCount}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </>
                        )}
                    </aside>

                    {/* Main Content Area */}
                    <main className="flex-1 flex flex-col bg-[#1a1b26] overflow-hidden min-w-0">
                        {terminalMode ? (
                            <header className="h-[73px] flex items-center px-4 border-b border-[#5e5e75] bg-[#16161e] shrink-0" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                                <span style={{ color: '#5fafff' }}>$</span>
                                <span style={{ color: '#e0e0e0', marginLeft: '8px' }}>
                                    {activeSection === 'main' ? 'cat' : 'tail -f'} {selectedChatId ? `chat_${selectedChatId.slice(-6)}` : 'stdin'}
                                </span>
                                <span style={{ color: '#333', marginLeft: '8px' }}>|</span>
                                <span style={{ color: '#444', marginLeft: '8px', flex: 1 }}>
                                    {activeSection === 'chats' && dialogs.find(d => d.entity?.id?.toString() === selectedChatId)?.title}
                                </span>
                            </header>
                        ) : (
                            <header className="h-[73px] flex items-center justify-between px-6 border-b border-[#5e5e75] bg-[#16161e] shrink-0">
                                <div className="flex flex-1 items-center gap-4 max-w-xl">
                                    <div className="relative flex-1">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-[#787c99]"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                        <input type="text" placeholder="Поиск" className="w-full bg-[#1a1b26] border border-[#5e5e75] rounded-xl py-2.5 pl-10 pr-4 text-white text-sm outline-none focus:border-[#7aa2f7]" />
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 ml-4 shrink-0">
                                    <div className="w-[38px] h-[38px] rounded-full bg-gradient-to-r from-[#e0af68] to-[#db9d47] flex items-center justify-center text-[#1a1b26] font-bold text-sm shadow-[0_4px_10px_rgba(224,175,104,0.3)] cursor-pointer">
                                        MГ
                                    </div>
                                </div>
                            </header>
                        )}

                        <div className="p-6 md:p-8 flex flex-col gap-6 w-full flex-1 overflow-hidden min-h-0">
                            {activeSection === 'main' ? (
                                <>
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
                                        <div className="flex flex-col">
                                            <h2 className="text-2xl font-manrope font-medium text-white flex items-center gap-3">
                                                {navItems.find(i => i.id === activeTab)?.label}
                                            </h2>
                                            <span className="text-sm text-[#787c99] mt-1 font-mono tracking-wide">ID: {selectedChatId || 'Облако'}</span>
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 pb-2 border-b border-[#2a2a35]">
                                        <div className="flex bg-[#16161e] p-1 rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]">
                                            <button className="tab-pill px-4 py-1.5 rounded-lg text-sm font-medium bg-[#2a2a35] text-white shadow-[0_2px_8px_rgba(0,0,0,0.2)]">Файлы</button>
                                        </div>
                                        <div className="flex bg-[#16161e] p-1 rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]">
                                            <button className="view-btn p-2 rounded-lg bg-[#2a2a35] text-white shadow-[0_2px_8px_rgba(0,0,0,0.2)]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg></button>
                                        </div>
                                    </div>

                                    {renderFileRows()}
                                </>
                            ) : (
                                <>
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
                                        <div className="flex flex-col">
                                            <h2 className="text-2xl font-manrope font-medium text-white flex items-center gap-3">
                                                {dialogs.find(d => d.entity?.id?.toString() === selectedChatId)?.title || (selectedChatId === myId?.toString() ? "Saved Messages" : "Чат")}
                                            </h2>
                                            <span className="text-sm text-[#787c99] mt-1 font-mono tracking-wide">ID: {selectedChatId || 'Облако'}</span>
                                        </div>
                                    </div>
                                    {renderChatMessages()}
                                    <form onSubmit={handleSendMessage} className={terminalMode ? "flex gap-2 shrink-0 border-t border-[#333] pt-2 mt-2" : "flex gap-3 shrink-0 p-2 bg-[#16161e] border border-[#5e5e75] rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] mt-auto"}>
                                        <input
                                            type="text"
                                            value={draftMessage}
                                            onChange={e => setDraftMessage(e.target.value)}
                                            placeholder={terminalMode ? "> TYPE YOUR MESSAGE..." : "Написать сообщение..."}
                                            className={terminalMode ? "flex-1 bg-black border border-[#333] text-[#00ff41] px-2 py-1 outline-none font-mono text-[13px] focus:border-[#5fafff]" : "flex-1 bg-transparent text-white px-3 py-2 outline-none placeholder-[#787c99]"}
                                        />
                                        <button
                                            type="submit"
                                            disabled={!draftMessage.trim()}
                                            className={terminalMode ? "px-4 font-mono text-[13px] text-[#5fafff] border border-[#333] bg-[#111] hover:bg-[#222]" : "w-10 h-10 shrink-0 flex items-center justify-center rounded-lg bg-[#7aa2f7] text-[#16161e] hover:bg-[#92b5ff] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"}
                                        >
                                            {terminalMode ? "[SEND]" : <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className="w-[18px] h-[18px] ml-0.5"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>}
                                        </button>
                                    </form>
                                </>
                            )}
                        </div>
                    </main>
                </div>
            </div >
        </>
    )
}
