// Graphics and Performance Configuration
// Values are tuned for [Mobile, Desktop] experience

export const PERFORMANCE_CONFIG = {
    mobile: {
        // App / Canvas
        dpr: [1, 1],             // Strict 1x pixel ratio for mobile
        enableBloom: false,      // DISABLE BLOOM entirely for max FPS

        // Stars
        starsCount: 400,         // Reduced from 800

        // Black Hole (Main Disk)
        blackHoleCount: 3000,    // Reduced from 6000

        // Black Hole Particles (Secondary systems)
        innerDiskCount: 400,     // Reduced from 800
        orbitalCount: 500,       // Reduced from 1000
        spiralCount: 600,        // Reduced from 1200
        ambientCount: 150,       // Reduced from 300

        // Post Processing (If enabled)
        bloomHeight: 100,        // Minimal buffer if forced on
        bloomSmoothing: 0.8,
    },
    desktop: {
        dpr: [1, 1.5],
        enableBloom: true,       // Enable high-quality post processing
        starsCount: 2000,
        blackHoleCount: 65000,
        innerDiskCount: 5000,
        orbitalCount: 6000,
        spiralCount: 7000,
        ambientCount: 2000,
        bloomHeight: 300,
        bloomSmoothing: 0.9,
    }
}
