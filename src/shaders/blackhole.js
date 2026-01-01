export const vertexShader = `
varying vec2 vUv;
varying vec3 vPosition;

void main() {
  vUv = uv;
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const fragmentShader = `
uniform float uTime;
varying vec2 vUv;

// Simple pseudo-random noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = rot * p * 2.0 + vec2(0.0, uTime * 0.2); // Add flow
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv);
    float angle = atan(uv.y, uv.x);

    // Event Horizon (Black Center)
    float horizon = 0.15;
    float hole = smoothstep(horizon, horizon + 0.02, r);

    // Accretion Disk
    // Spiral effect using angle and radius
    float spiral = fbm(vec2(r * 3.0 - uTime * 0.5, angle * 2.0));
    float disk = smoothstep(0.15, 0.5, r) * (1.0 - smoothstep(0.4, 0.5, r));
    
    // Color mapping
    vec3 colorCore = vec3(1.0, 0.6, 0.1); // Orange/Gold
    vec3 colorEdge = vec3(0.5, 0.1, 0.05); // Dark Red
    
    vec3 finalColor = mix(colorEdge, colorCore, spiral) * disk * 4.0;
    
    // Add glow
    finalColor += vec3(0.1, 0.05, 0.0) / (r * 2.0 + 0.1); // Ambient glow

    float alpha = hole;
    
    // Strict circular mask to prevent square corners
    alpha *= (1.0 - smoothstep(0.48, 0.5, r));

    gl_FragColor = vec4(finalColor * alpha, alpha); // Hide center, keep alpha
    
    // Add additive blending hint via alpha or pre-multiplied
    gl_FragColor.rgb *= 2.0; // Boost brightness
}
`
