import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import './StaggeredMenu.css';
import { useStore } from '../../store/useStore';

export const StaggeredMenu = ({
    position = 'right',
    colors = ['#B19EEF', '#5227FF'],
    items = [],
    socialItems = [],
    displaySocials = true,
    displayItemNumbering = true,
    className,
    logoUrl = '/src/assets/logos/reactbits-gh-white.svg',
    menuButtonColor = '#fff',
    openMenuButtonColor = '#000',
    changeMenuColorOnOpen = true,
    accentColor = '#5227FF',
    isFixed = false,
    closeOnClickAway = true,
    onMenuOpen,
    onMenuClose
}) => {
    const [open, setOpen] = useState(false);
    const openRef = useRef(false);
    const panelRef = useRef(null);
    const preLayersRef = useRef(null);
    const preLayerElsRef = useRef([]);
    const plusHRef = useRef(null);
    const plusVRef = useRef(null);
    const iconRef = useRef(null);
    const textInnerRef = useRef(null);
    const textWrapRef = useRef(null);
    const [textLines, setTextLines] = useState(['Menu', 'Close']);

    const openTlRef = useRef(null);
    const closeTweenRef = useRef(null);
    const spinTweenRef = useRef(null);
    const textCycleAnimRef = useRef(null);
    const colorTweenRef = useRef(null);
    const toggleBtnRef = useRef(null);
    const busyRef = useRef(false);
    const itemEntranceTweenRef = useRef(null);

    const { setSection, setIsMenuOpen } = useStore();

    // Lock body scroll when menu is open — prevents touch-scroll passing through the fixed overlay
    useEffect(() => {
        if (open) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            const panel = panelRef.current;
            const preContainer = preLayersRef.current;
            const plusH = plusHRef.current;
            const plusV = plusVRef.current;
            const icon = iconRef.current;
            const textInner = textInnerRef.current;
            if (!panel || !plusH || !plusV || !icon || !textInner) return;

            let preLayers = [];
            if (preContainer) {
                preLayers = Array.from(preContainer.querySelectorAll('.sm-prelayer'));
            }
            preLayerElsRef.current = preLayers;

            const offscreen = position === 'left' ? -100 : 100;

            // ── Initial hidden states ────────────────────────────
            gsap.set([panel, ...preLayers], { xPercent: offscreen });
            gsap.set(plusH, { transformOrigin: '50% 50%', rotate: 0 });
            gsap.set(plusV, { transformOrigin: '50% 50%', rotate: 90 });
            gsap.set(icon, { rotate: 0, transformOrigin: '50% 50%' });
            gsap.set(textInner, { yPercent: 0 });
            if (toggleBtnRef.current) gsap.set(toggleBtnRef.current, { color: menuButtonColor });

            // Query once — items don't change after mount
            const itemEls = Array.from(panel.querySelectorAll('.sm-panel-itemLabel'));
            const numberEls = Array.from(panel.querySelectorAll('.sm-panel-list[data-numbering] .sm-panel-item'));
            const socialTitle = panel.querySelector('.sm-socials-title');
            const socialLinks = Array.from(panel.querySelectorAll('.sm-socials-link'));

            if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });
            if (numberEls.length) gsap.set(numberEls, { '--sm-num-opacity': 0 });
            if (socialTitle) gsap.set(socialTitle, { opacity: 0 });
            if (socialLinks.length) gsap.set(socialLinks, { y: 25, opacity: 0 });

            // ── Pre-build open timeline (fromTo = safe restart) ──
            const tl = gsap.timeline({ paused: true });

            preLayers.forEach((el, i) => {
                tl.fromTo(el,
                    { xPercent: offscreen },
                    { xPercent: 0, duration: 0.5, ease: 'power4.out' },
                    i * 0.07
                );
            });

            const lastLayerTime = preLayers.length ? (preLayers.length - 1) * 0.07 : 0;
            const panelStart = lastLayerTime + (preLayers.length ? 0.08 : 0);
            const panelDuration = 0.65;
            tl.fromTo(panel,
                { xPercent: offscreen },
                { xPercent: 0, duration: panelDuration, ease: 'power4.out' },
                panelStart
            );

            if (itemEls.length) {
                const itemsAt = panelStart + panelDuration * 0.15;
                tl.fromTo(itemEls,
                    { yPercent: 140, rotate: 10 },
                    {
                        yPercent: 0, rotate: 0, duration: 1, ease: 'power4.out',
                        stagger: { each: 0.1, from: 'start' }
                    },
                    itemsAt
                );
                if (numberEls.length) {
                    tl.fromTo(numberEls,
                        { '--sm-num-opacity': 0 },
                        {
                            '--sm-num-opacity': 1, duration: 0.6, ease: 'power2.out',
                            stagger: { each: 0.08, from: 'start' }
                        },
                        itemsAt + 0.1
                    );
                }
            }

            const socialsAt = panelStart + panelDuration * 0.4;
            if (socialTitle) {
                tl.fromTo(socialTitle,
                    { opacity: 0 },
                    { opacity: 1, duration: 0.5, ease: 'power2.out' },
                    socialsAt
                );
            }
            if (socialLinks.length) {
                tl.fromTo(socialLinks,
                    { y: 25, opacity: 0 },
                    {
                        y: 0, opacity: 1, duration: 0.55, ease: 'power3.out',
                        stagger: { each: 0.08, from: 'start' }
                    },
                    socialsAt + 0.04
                );
            }

            openTlRef.current = tl;
        });
        return () => ctx.revert();
    }, [menuButtonColor, position]);

    // playOpen: pre-built timeline — restart() is nearly zero cost on click
    const playOpen = useCallback(() => {
        if (busyRef.current) return;
        busyRef.current = true;
        // Kill any running close animation to prevent tween conflict
        closeTweenRef.current?.kill();
        closeTweenRef.current = null;
        const tl = openTlRef.current;
        if (tl) {
            tl.eventCallback('onComplete', () => { busyRef.current = false; });
            tl.restart();
        } else {
            busyRef.current = false;
        }
    }, []);

    const playClose = useCallback(() => {
        // Pause (not kill) the pre-built open timeline so restart() works next time
        openTlRef.current?.pause();
        itemEntranceTweenRef.current?.kill();

        const panel = panelRef.current;
        const layers = preLayerElsRef.current;
        if (!panel) return;

        const all = [...layers, panel];
        closeTweenRef.current?.kill();
        const offscreen = position === 'left' ? -100 : 100;
        closeTweenRef.current = gsap.to(all, {
            xPercent: offscreen,
            duration: 0.32,
            ease: 'power3.in',
            overwrite: 'auto',
            onComplete: () => {
                busyRef.current = false;
                // fromTo in pre-built timeline resets initial states on restart() — no manual reset needed
            }
        });
    }, [position]);

    const animateIcon = useCallback((opening) => {
        const icon = iconRef.current;
        if (!icon) return;
        spinTweenRef.current?.kill();
        if (opening) {
            spinTweenRef.current = gsap.to(icon, { rotate: 225, duration: 0.8, ease: 'power4.out', overwrite: 'auto' });
        } else {
            spinTweenRef.current = gsap.to(icon, { rotate: 0, duration: 0.35, ease: 'power3.inOut', overwrite: 'auto' });
        }
    }, []);

    const animateColor = useCallback(
        (opening) => {
            const btn = toggleBtnRef.current;
            if (!btn) return;
            colorTweenRef.current?.kill();
            if (changeMenuColorOnOpen) {
                const targetColor = opening ? openMenuButtonColor : menuButtonColor;
                colorTweenRef.current = gsap.to(btn, {
                    color: targetColor,
                    delay: 0.18,
                    duration: 0.3,
                    ease: 'power2.out'
                });
            } else {
                gsap.set(btn, { color: menuButtonColor });
            }
        },
        [openMenuButtonColor, menuButtonColor, changeMenuColorOnOpen]
    );

    React.useEffect(() => {
        if (toggleBtnRef.current) {
            if (changeMenuColorOnOpen) {
                const targetColor = openRef.current ? openMenuButtonColor : menuButtonColor;
                gsap.set(toggleBtnRef.current, { color: targetColor });
            } else {
                gsap.set(toggleBtnRef.current, { color: menuButtonColor });
            }
        }
    }, [changeMenuColorOnOpen, menuButtonColor, openMenuButtonColor]);

    const animateText = useCallback((opening) => {
        const inner = textInnerRef.current;
        if (!inner) return;
        textCycleAnimRef.current?.kill();

        const currentLabel = opening ? 'Menu' : 'Close';
        const targetLabel = opening ? 'Close' : 'Menu';
        const cycles = 3;
        const seq = [currentLabel];
        let last = currentLabel;
        for (let i = 0; i < cycles; i++) {
            last = last === 'Menu' ? 'Close' : 'Menu';
            seq.push(last);
        }
        if (last !== targetLabel) seq.push(targetLabel);
        seq.push(targetLabel);

        // React 18 batches this with setOpen/setIsMenuOpen — single commit before next paint
        setTextLines(seq);

        // GSAP animates the container yPercent — doesn’t depend on child span count
        gsap.set(inner, { yPercent: 0 });
        const lineCount = seq.length;
        const finalShift = ((lineCount - 1) / lineCount) * 100;
        textCycleAnimRef.current = gsap.to(inner, {
            yPercent: -finalShift,
            duration: 0.5 + lineCount * 0.07,
            ease: 'power4.out'
        });
    }, []);

    const toggleMenu = useCallback(() => {
        const target = !openRef.current;
        openRef.current = target;
        setOpen(target);
        setIsMenuOpen(target); // Sync with store
        if (target) {
            onMenuOpen?.();
            playOpen();
        } else {
            onMenuClose?.();
            playClose();
        }
        animateIcon(target);
        animateColor(target);
        animateText(target);
    }, [playOpen, playClose, animateIcon, animateColor, animateText, setIsMenuOpen, onMenuOpen, onMenuClose]);

    const closeMenu = useCallback(() => {
        if (openRef.current) {
            openRef.current = false;
            setOpen(false);
            setIsMenuOpen(false); // Sync with store
            onMenuClose?.();
            playClose();
            animateIcon(false);
            animateColor(false);
            animateText(false);
        }
    }, [playClose, animateIcon, animateColor, animateText, onMenuClose, setIsMenuOpen]);

    React.useEffect(() => {
        if (!closeOnClickAway || !open) return;

        const handleClickOutside = (event) => {
            if (
                panelRef.current &&
                !panelRef.current.contains(event.target) &&
                toggleBtnRef.current &&
                !toggleBtnRef.current.contains(event.target)
            ) {
                closeMenu();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [closeOnClickAway, open, closeMenu]);

    // Handle navigation click for single-page app
    const handleItemClick = (e, id) => {
        e.preventDefault();
        setSection(id);
        closeMenu();
    };

    return (
        <div
            className={(className ? className + ' ' : '') + 'staggered-menu-wrapper' + (isFixed ? ' fixed-wrapper' : '')}
            style={accentColor ? { '--sm-accent': accentColor } : undefined}
            data-position={position}
            data-open={open || undefined}
        >
            <div ref={preLayersRef} className="sm-prelayers" aria-hidden="true">
                {(() => {
                    const arr = colors && colors.length ? colors.slice(0, 4) : ['#1e1e22', '#35353c'];
                    return arr.map((c, i) => <div key={i} className="sm-prelayer" style={{ background: c }} />);
                })()}
            </div>
            <header className="staggered-menu-header" aria-label="Main navigation header">
                <div className="sm-logo" aria-label="Logo">
                    {/* Logo removed or can be replaced */}
                </div>
                <button
                    ref={toggleBtnRef}
                    className="sm-toggle"
                    aria-label={open ? 'Close menu' : 'Open menu'}
                    aria-expanded={open}
                    aria-controls="staggered-menu-panel"
                    onClick={toggleMenu}
                    type="button"
                >
                    <span ref={textWrapRef} className="sm-toggle-textWrap" aria-hidden="true">
                        <span ref={textInnerRef} className="sm-toggle-textInner">
                            {textLines.map((l, i) => (
                                <span className="sm-toggle-line" key={i}>
                                    {l}
                                </span>
                            ))}
                        </span>
                    </span>
                    <span ref={iconRef} className="sm-icon" aria-hidden="true">
                        <span ref={plusHRef} className="sm-icon-line" />
                        <span ref={plusVRef} className="sm-icon-line sm-icon-line-v" />
                    </span>
                </button>
            </header>

            <aside id="staggered-menu-panel" ref={panelRef} className="staggered-menu-panel" aria-hidden={!open}>
                <div className="sm-panel-inner">
                    <ul className="sm-panel-list" role="list" data-numbering={displayItemNumbering || undefined}>
                        {items && items.length ? (
                            items.map((it, idx) => (
                                <li className="sm-panel-itemWrap" key={it.label + idx}>
                                    <a
                                        className="sm-panel-item"
                                        href={it.link}
                                        aria-label={it.ariaLabel}
                                        data-index={idx + 1}
                                        onClick={(e) => handleItemClick(e, it.id)}
                                    >
                                        <span className="sm-panel-itemLabel">{it.label}</span>
                                    </a>
                                </li>
                            ))
                        ) : (
                            <li className="sm-panel-itemWrap" aria-hidden="true">
                                <span className="sm-panel-item">
                                    <span className="sm-panel-itemLabel">No items</span>
                                </span>
                            </li>
                        )}
                    </ul>
                    {displaySocials && socialItems && socialItems.length > 0 && (
                        <div className="sm-socials" aria-label="Social links">
                            <h3 className="sm-socials-title">Socials</h3>
                            <ul className="sm-socials-list" role="list">
                                {socialItems.map((s, i) => (
                                    <li key={s.label + i} className="sm-socials-item">
                                        <a href={s.link} target="_blank" rel="noopener noreferrer" className="sm-socials-link">
                                            {s.label}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </aside>
        </div>
    );
};

export default StaggeredMenu;
