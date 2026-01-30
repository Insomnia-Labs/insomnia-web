// Layout constants for 3D scene and UI positioning

export const CAMERA_SETTINGS = {
    mobile: {
        // Camera positioning logic
        dist: 9.0,         // Distance from target
        height: 2.5,       // Height offset
        sideOffset: 0,     // Horizontal offset (0 = centered)
        lookRightOffset: 0 // Look target offset (0 = centered)
    },
    desktop: {
        dist: 7.0,
        height: 2.0,
        sideOffset: 3.0,   // Push camera right so object appears on left
        lookRightOffset: 3.5 // Look slightly right of object to frame it nicely
    }
}

export const LAYOUT_CONFIG = {
    mobileBreakpoint: 768,
    // Add other layout specific constants here as needed
}
